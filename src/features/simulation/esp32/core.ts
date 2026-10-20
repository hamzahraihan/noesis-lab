import type { ExecutionBackend } from '../avr/backend';
import { ESP32_CLOCK_HZ, ESP32_MAX_STEP_MS, cyclesPerMs, type Esp32Hooks } from './backend';
import { bootEsp32, type Esp32Emulator } from './emulator';

/** The pieces the chip boots from. */
export interface Esp32Firmware {
  /** The emulator's WebAssembly module. */
  readonly wasm: ArrayBuffer;
  /** The chip's mask ROM, as the ELF the ROM boot expects. */
  readonly rom: ArrayBuffer;
  /** The application image, flashed at 0x1000. */
  readonly image: ArrayBuffer;
  /** The filesystem image the chip mounts, or nothing for a bare REPL. */
  readonly filesystem?: Uint8Array;
}

/** How many pins the chip's GPIO words cover. */
const PINS = 32;

/**
 * The emulated ESP32 behind the bench's pump contract: boot the pinned
 * firmware with the sketch in its filesystem, step it against the engine's
 * clock, and bridge pins and serial through hooks.
 *
 * The chip is the real thing -- its own mask ROM, the real bootloader, the
 * real MicroPython -- so a sketch that runs here is a sketch that runs on
 * the board. The pins cross the boundary under the chip's own numbering,
 * which is the numbering the board's header holes carry.
 */
export class Esp32Backend implements ExecutionBackend {
  private readonly firmware: Esp32Firmware;
  private readonly hooks: Esp32Hooks;
  private chip: Esp32Emulator | null = null;
  private failed: string | null = null;
  /** The levels the chip last drove, so a change is a change. */
  private readonly driven = new Map<number, boolean>();

  constructor(firmware: Esp32Firmware, hooks: Esp32Hooks) {
    this.firmware = firmware;
    this.hooks = hooks;
  }

  get fault(): string | null {
    return this.failed;
  }

  /**
   * Starts the chip.
   *
   * The boot is asynchronous -- the WebAssembly module has to compile -- so
   * the worker attaches the backend and then starts it, the way the RP2 path
   * attaches a machine that boots in the background.
   */
  async start(): Promise<void> {
    try {
      this.chip = await bootEsp32(
        {
          wasm: this.firmware.wasm,
          rom: this.firmware.rom,
          image: this.firmware.image,
        },
        this.firmware.filesystem,
      );
      this.failed = null;
    } catch (error) {
      this.failed = `esp32 boot failed: ${String(error)}`;
      this.chip = null;
    }
  }

  step(budgetMs: number): void {
    if (this.failed || !this.chip) return;
    const clamped = Math.min(Math.max(budgetMs, 0), ESP32_MAX_STEP_MS);
    // The chip runs in slices: a whole budget in one call would be a long
    // pause in the page, and the bench's frames would stutter.
    const sliceCycles = cyclesPerMs(ESP32_CLOCK_HZ);
    let remaining = clamped;
    try {
      while (remaining > 0) {
        const sliceMs = Math.min(remaining, 1);
        remaining -= sliceMs;
        for (const line of this.chip.run(sliceCycles * sliceMs)) {
          this.hooks.serial.serialWrite(line);
        }
        this.pushDrivenLevels();
        this.settleIfDue();
      }
    } catch (error) {
      this.failed = `esp32 fault: ${String(error)}`;
    }
  }

  reset(): void {
    this.driven.clear();
    void this.start();
  }

  /**
   * Tells the engine what the chip drove.
   *
   * The chip's GPIO words say which pads it drives and at what level; a pad
   * that changes is an edge the engine wants, and a pad that stops being
   * driven goes back to being an input.
   */
  private pushDrivenLevels(): void {
    if (!this.chip) return;
    const enabled = this.chip.gpioOutEnable;
    const levels = this.chip.gpioOut;
    for (let pin = 0; pin < PINS; pin++) {
      const mask = 1n << BigInt(pin);
      const isOutput = (enabled & mask) !== 0n;
      const high = (levels & mask) !== 0n;
      const previous = this.driven.get(pin);
      if (isOutput) {
        this.hooks.mcu.setDirection(pin, 'output');
        this.hooks.mcu.writeDigital(pin, high, this.hooks.nowMs());
        if (previous !== undefined && previous !== high) {
          this.hooks.onEdge?.(pin, this.chip.cycles, high);
        }
        this.driven.set(pin, high);
      } else if (previous !== undefined) {
        this.hooks.mcu.setDirection(pin, 'input');
        this.driven.delete(pin);
      }
    }
  }

  /**
   * Tells the chip what the engine holds, and settles.
   *
   * The chip reads its inputs from the pads the board's parts drive, so the
   * engine's levels have to reach them; then the engine settles, because the
   * chip has moved.
   */
  private settleIfDue(): void {
    if (!this.chip) return;
    for (let pin = 0; pin < PINS; pin++) {
      if (this.driven.has(pin)) continue;
      this.chip.setInput(pin, this.hooks.readPin(pin));
    }
    this.hooks.onSettle();
  }
}
