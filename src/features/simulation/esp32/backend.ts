import type { McuRuntime } from '../mcu';
import type { Esp32I2cSink } from './i2c';
import type { Esp32SpiSink } from './spi';

/**
 * Hooks the engine drives, mirroring avr/core.ts's AvrHooks subset.
 *
 * The ESP32's GPIO numbers are the chip's own -- the board's header holes
 * carry them (D2 is GPIO2, VP is GPIO36) -- so a pin crosses this boundary
 * under its own name, with no remapping table in between.
 */
export interface Esp32Hooks {
  readonly mcu: McuRuntime;
  /** The engine's clock, in milliseconds. */
  readonly nowMs: () => number;
  /** The level the engine holds on a pin, for a pin the chip reads. */
  readonly readPin: (gpio: number) => boolean;
  /** Called when the engine should settle: the chip has run. */
  readonly onSettle: () => void;
  /** A driven pin changed level, for the engine's edge bookkeeping. */
  readonly onEdge?: (gpio: number, cycles: number, high: boolean) => void;
  readonly serial: { serialWrite(text: string): void };
  /** The bench's I2C bus, which the chip's controller talks to. */
  readonly i2c: Esp32I2cSink;
  /** The bench's SPI bus, which the chip's master talks to. */
  readonly spi: Esp32SpiSink;
}

/** The chip's clock, in hertz: the classic ESP32 runs at 240 MHz. */
export const ESP32_CLOCK_HZ = 240_000_000;

/** The longest a single step may run, in milliseconds. */
export const ESP32_MAX_STEP_MS = 40;

/**
 * How many chip cycles one millisecond of engine time is.
 *
 * The chip is not cycle-accurate against the wall clock -- the emulator runs
 * a slice at a time and the host decides how much of it to spend -- so this
 * is the conversion the pacing uses, and the engine's own clock is what the
 * bench measures.
 */
export function cyclesPerMs(clockHz: number): number {
  return Math.round(clockHz / 1000);
}
