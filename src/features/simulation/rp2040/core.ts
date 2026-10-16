import { ConsoleLogger, LogLevel, RP2040 } from 'rp2040js';
import type { ExecutionBackend } from '../avr/backend';
import {
  CYCLE_NANOS,
  LITTLEFS_FLASH_OFFSET,
  RP2040_CLOCK_HZ,
  RP2040_MAX_STEP_MS,
  type Rp2040Hooks,
} from './backend';
import { bootromB1 } from './bootrom';
import { Rp2040Clock } from './clock';
import { attachRp2040GpioBridge } from './gpio';
import { decodeUf2, type Uf2Image } from './uf2';
import { Rp2040Serial } from './usb';

/** XIP base of the RP2040's flash; rp2040js hides this constant behind its exports map. */
const FLASH_START_ADDRESS = 0x10000000;

/** One millisecond of instructions between settles. */
const SETTLE_CYCLES = RP2040_CLOCK_HZ / 1000;

export interface Rp2040Firmware {
  /** Raw .uf2 file bytes; decoded on construction. */
  readonly uf2: Uint8Array;
  /** LittleFS image mounted at LITTLEFS_FLASH_OFFSET (empty image = REPL). */
  readonly image: Uint8Array;
}

/**
 * The MicroPython engine behind the bench's pump contract: boot the pinned
 * firmware, step it in 8 ns cycles on our own alarm-driven clock, and bridge
 * pins and serial through hooks. Reconstruction on reset is whole-machine —
 * a fresh RP2040, clock, and bridges — which is what "reset restarts the
 * firmware cleanly" means here (recon: fresh-instance boot, no ROM path).
 */
export class Rp2040Backend implements ExecutionBackend {
  private readonly firmware: Rp2040Firmware;
  private readonly hooks: Rp2040Hooks;
  private readonly flash: Uf2Image;
  private clock = new Rp2040Clock();
  private rp2040: RP2040;
  private serial: Rp2040Serial;
  private failed: string | null = null;
  private settledAtCycle = 0;

  constructor(firmware: Rp2040Firmware, hooks: Rp2040Hooks) {
    this.firmware = firmware;
    this.hooks = hooks;
    this.flash = decodeUf2(firmware.uf2);
    this.rp2040 = this.buildMachine();
    this.serial = this.attachBridges();
  }

  get fault(): string | null {
    return this.failed;
  }

  step(budgetMs: number): void {
    if (this.failed) return;
    const clamped = Math.min(Math.max(budgetMs, 0), RP2040_MAX_STEP_MS);
    const endNanos = this.clock.nanos + clamped * 1_000_000;
    try {
      while (this.clock.nanos < endNanos) {
        if (this.rp2040.core.waiting) {
          const toAlarm = this.clock.nanosToNextAlarm;
          if (toAlarm <= 0) break;
          this.clock.tick(Math.min(toAlarm, endNanos - this.clock.nanos));
        } else {
          const cycles = this.rp2040.core.executeInstruction();
          this.clock.tick(cycles * CYCLE_NANOS);
        }
        this.serial.poll();
        this.settleIfDue();
      }
    } catch (error) {
      this.failed = `core fault at PC=0x${this.rp2040.core.PC.toString(16)} cycles=${this.rp2040.core.cycles}: ${String(error)}`;
    }
  }

  reset(): void {
    this.rp2040 = this.buildMachine();
    this.serial = this.attachBridges();
    this.failed = null;
    this.settledAtCycle = 0;
  }

  private buildMachine(): RP2040 {
    const clock = new Rp2040Clock();
    this.clock = clock;
    const rp2040 = new RP2040(clock);
    rp2040.logger = new ConsoleLogger(LogLevel.Error);
    rp2040.loadBootrom(bootromB1);
    rp2040.flash.set(this.flash.data, this.flash.baseAddress - FLASH_START_ADDRESS);
    rp2040.flash.set(this.firmware.image, LITTLEFS_FLASH_OFFSET);
    // Skip the ROM's boot path: recon-verified entry into the flashed image.
    rp2040.core.PC = FLASH_START_ADDRESS;
    return rp2040;
  }

  private attachBridges(): Rp2040Serial {
    attachRp2040GpioBridge(this.rp2040, this.hooks);
    return new Rp2040Serial(this.rp2040, this.clock, this.hooks.serial);
  }

  private settleIfDue(): void {
    const { cycles } = this.rp2040.core;
    if (cycles - this.settledAtCycle < SETTLE_CYCLES) return;
    this.settledAtCycle = cycles;
    this.hooks.onSettle();
    for (const pin of this.rp2040.gpio) pin.setInputValue(this.hooks.readPin(pin.index));
  }
}
