/**
 * ESP32 machine code backend: wraps `esp32-emu`'s SimulatorWorker.
 *
 * This is the spike: we're validating that `esp32-emu` can run in our
 * build pipeline (Vite + COOP/COEP + SharedArrayBuffer).
 */
import { SimulatorWorker } from 'esp32-emu';
import type { McuRuntime } from '@/features/simulation/mcu';
import type { ExecutionBackend } from '../avr/backend';

export type Esp32Hooks = {
  mcu: McuRuntime;
  nowMs: () => number;
  readPin: (gpio: number) => boolean;
  onSettle: () => void;
  onEdge?: (gpio: number, cycles: number, high: boolean) => void;
  serial: { serialWrite(text: string): void };
  i2c: {
    writeByte(address: number, byte: number, isFirst: boolean): boolean;
    readByte(address: number, index: number): number;
    writeEnd?(): void;
  };
  spi: {
    transfer(byte: number, dataSelect: boolean, chipSelected: boolean): void;
    end(): void;
  };
};

const ESP32_MAX_STEP_MS = 40;

export interface Esp32MachineAssets {
  wasm: ArrayBuffer;
  rom: ArrayBuffer;
}

export async function fetchEsp32MachineAssets(): Promise<Esp32MachineAssets> {
  const [wasmRes, romRes] = await Promise.all([
    fetch(new URL('esp32-emu/engine/esp-xtensa/esp_engine_wasm.wasm', import.meta.url)),
    fetch(new URL('esp32-emu/rom/esp32-v3-rom.bin', import.meta.url)),
  ]);
  if (!wasmRes.ok || !romRes.ok) {
    throw new Error('Failed to fetch ESP32 assets');
  }
  return { wasm: await wasmRes.arrayBuffer(), rom: await romRes.arrayBuffer() };
}

export class Esp32MachineBackend implements ExecutionBackend {
  private readonly hooks: Esp32Hooks;
  private worker: SimulatorWorker | null = null;
  private failed: string | null = null;

  constructor(hooks: Esp32Hooks) {
    this.hooks = hooks;
  }

  get fault(): string | null {
    return this.failed;
  }

  async start(rom: ArrayBuffer, image: ArrayBuffer, filesystem?: Uint8Array): Promise<void> {
    try {
      this.worker = new SimulatorWorker();

      this.worker._onUART = (byte: number) => {
        this.hooks.serial.serialWrite(String.fromCharCode(byte));
      };

      this.worker._onError = (err: Error) => {
        this.failed = `esp32-machine error: ${err.message}`;
      };

      const flash = new Uint8Array(4 * 1024 * 1024).fill(0xff);

      await this.worker.init(
        'ESP32',
        { board: 'esp32', flashSizeMB: 4, psramSizeMB: 4, budget: 2_000_000 },
        flash,
        new Uint8Array(rom),
      );

      if (this.worker.memory?.flash) {
        const flashView = this.worker.memory.flash;
        flashView.set(new Uint8Array(image), 0x1000);
      }

      if (filesystem && this.worker.memory?.flash) {
        this.worker.memory.flash.set(new Uint8Array(filesystem), 0x290000);
      }

      this.worker.reset();
      this.worker.run();
      this.failed = null;
    } catch (error) {
      this.failed = `esp32-machine start failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  step(budgetMs: number): void {
    if (!this.worker || this.failed) return;
    const clamped = Math.min(Math.max(budgetMs, 0), ESP32_MAX_STEP_MS);
    try {
      this.worker.step(clamped);
    } catch (error) {
      this.failed = `esp32-machine step failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  reset(): void {
    if (this.worker) {
      this.worker.reset();
      this.failed = null;
    }
  }

  readPin(_gpio: number): boolean {
    return false;
  }

  onEdge(_gpio: number, _cycles: number, _high: boolean): void {
    // Gpio-level bridging is handled by the chip's own GPIO state.
  }

  onSettle(): void {
    if (!this.worker) return;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

export async function createEsp32MachineBackend(
  hooks: Esp32Hooks,
  image: ArrayBuffer,
  filesystem?: Uint8Array,
): Promise<Esp32MachineBackend> {
  const assets = await fetchEsp32MachineAssets();
  const backend = new Esp32MachineBackend(hooks);
  await backend.start(assets.rom, image, filesystem);
  return backend;
}
