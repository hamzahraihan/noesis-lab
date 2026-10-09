/** The seam Simulation programs to. One implementer today (AvrBackend); the
 * interpreter path stays inline in Simulation per the no-touch rule. */
export interface ExecutionBackend {
  step(budgetMs: number): void;
  reset(): void;
  readonly fault: string | null;
}

export interface GpioMapEntry {
  readonly port: 'B' | 'C' | 'D';
  readonly bit: number;
  readonly gpio: number;
}

function* gpioEntries(): Generator<GpioMapEntry> {
  for (let bit = 0; bit < 8; bit++) yield { port: 'D', bit, gpio: bit };
  for (let bit = 0; bit < 6; bit++) yield { port: 'B', bit, gpio: 8 + bit };
  for (let bit = 0; bit < 6; bit++) yield { port: 'C', bit, gpio: 14 + bit };
}

export const UNO_GPIO_MAP: ReadonlyArray<GpioMapEntry> = [...gpioEntries()];
export const UNO_CLOCK_HZ = 16_000_000;
export function cyclesPerMs(clockHz: number): number {
  return Math.round(clockHz / 1000);
}
