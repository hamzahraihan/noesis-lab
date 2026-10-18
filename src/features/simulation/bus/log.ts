/**
 * A record of what went over the buses.
 *
 * The buses move bytes and the devices consume them, so neither one knows what
 * the transfer *was*. This is where a bench operator reads it back: which
 * device, which bytes, whether anything answered, and when.
 *
 * It is capped, because a sketch redrawing a screen sixty times a second would
 * otherwise grow it without bound -- and the oldest transfers are the ones
 * nobody is looking for.
 */

/** One transfer over either bus. */
export interface BusEntry {
  readonly timeMs: number;
  readonly bus: 'i2c' | 'spi';
  /** Seven-bit I2C address; null on SPI, which has no addressing. */
  readonly address: number | null;
  /** Bytes as they went out, in order. */
  readonly bytes: readonly number[];
  /** False when nothing on the bus claimed the transfer. */
  readonly acknowledged: boolean;
  readonly micros: number;
}

/** Transfers kept before the oldest are dropped. */
const CAPACITY = 200;

export class BusLog {
  private readonly entries: BusEntry[] = [];
  private snapshot: BusEntry[] = [];
  private dirty = true;

  record(entry: BusEntry): void {
    this.entries.push(entry);
    if (this.entries.length > CAPACITY) this.entries.splice(0, this.entries.length - CAPACITY);
    this.dirty = true;
  }

  /**
   * Oldest first, as a fresh array only when something has changed.
   *
   * The list is mutated in place, which is right for a chatty sketch but means
   * its identity never moves; a memoising panel would read it once and freeze.
   */
  lines(): readonly BusEntry[] {
    if (this.dirty) {
      this.snapshot = [...this.entries];
      this.dirty = false;
    }
    return this.snapshot;
  }

  clear(): void {
    this.entries.length = 0;
    this.dirty = true;
  }
}
