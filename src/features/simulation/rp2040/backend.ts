import type { McuRuntime } from '@/features/simulation/mcu';

/** Hooks the engine drives, mirroring avr/core.ts's AvrHooks subset. */
export interface Rp2040Hooks {
  readonly mcu: McuRuntime;
  readonly nowMs: () => number;
  readonly readPin: (gpio: number) => boolean;
  readonly onSettle: () => void;
  readonly onEdge?: (gpio: number, cycles: number, high: boolean) => void;
  readonly serial: { serialWrite(text: string): void };
}

export const RP2040_CLOCK_HZ = 125_000_000;
export const CYCLE_NANOS = 1_000_000_000 / RP2040_CLOCK_HZ; // 8 ns
export const RP2040_MAX_STEP_MS = 40;

/**
 * LittleFS geometry the MicroPython RP2 port expects (recon-verified): 352
 * blocks of 4096 bytes seated at 0xa0000, filling the rest of the Pico's
 * 2 MiB flash.
 */
export const LITTLEFS_BLOCK_SIZE = 4096;
export const LITTLEFS_BLOCK_COUNT = 352;
export const LITTLEFS_FLASH_OFFSET = 0xa0000;
