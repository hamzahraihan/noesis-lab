/**
 * 7-segment display state model: the digits behind the glass.
 *
 * The firmware multiplexes while the glass renders every digit at once. This
 * model latches each digit's pattern while its common is asserted, so the
 * renderer can push the whole frame every time instead of depending on which
 * digit a render happens to sample — sampling render instants can never
 * observe a multiplexed state reliably.
 *
 * Two multiplexing styles reach this glass. Digit-multiplexed firmware (the
 * raw GPIO port, the interpreter SevSeg model) lights one digit per solve
 * with its full pattern: the latch overwrites that digit. Segment-multiplexed
 * firmware (the real SevSeg library with resistors on digits, as the AVR
 * library HEX runs it) lights one segment per solve across every digit that
 * needs it: overwriting would keep only the last slice and the glass would
 * flicker through single segments. Single-segment slices therefore accumulate
 * (OR) per digit with a persistence window, while full patterns overwrite.
 *
 * Latching is edge-triggered (rising common) plus a refresh when the segment
 * lines move under an asserted digit. The refresh keeps a statically-driven
 * single digit live; it cannot ghost across digits because a refresh only
 * ever touches a digit whose common is currently high, and correct firmware
 * blanks all commons before moving the segments — exactly as real hardware
 * requires.
 *
 * The 4-digit clock glass carries a colon between digit 2 and 3 on its own
 * COM/CLN pins (KW4-56NALB pins 7/8): COM to 5V, CLN low lights it. It is
 * not multiplexed, so it follows the live forward bias rather than latching.
 */

/** Segment lines in bit order: bit i of a pattern is SEGMENT_ORDER[i]. */
export const SEGMENT_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'] as const;

/**
 * Forward bias treated as lit (common-anode: digit HIGH, segment LOW).
 * Measured ~2V with six diodes conducting; dark pairs read at or below zero.
 */
export const LIT_THRESHOLD_VOLTS = 1.0;

/**
 * Digit-common level treated as asserted. Commons sag under load (~2.8V with
 * six segments lit) while released commons sit at ~0V.
 */
export const DIGIT_THRESHOLD_VOLTS = 1.5;

/** Standard 7-segment encoding for 0-9, A-F and blank, in SEGMENT_ORDER bit order. */
export const SEGMENT_MAP: Readonly<Record<string, number>> = {
  '0': 0b00111111,
  '1': 0b00000110,
  '2': 0b01011011,
  '3': 0b01001111,
  '4': 0b01100110,
  '5': 0b01101101,
  '6': 0b01111101,
  '7': 0b00000111,
  '8': 0b01111111,
  '9': 0b01101111,
  A: 0b01110111,
  b: 0b01111100,
  C: 0b00111001,
  c: 0b01011000,
  D: 0b01111001,
  d: 0b01011110,
  E: 0b01111001,
  F: 0b01110001,
  '-': 0b01000000,
  ' ': 0b00000000,
};

/**
 * Persistence window for accumulated segment slices, in milliseconds of
 * simulated time. A segment-multiplexed cycle covers 7 segments at ~1.8 ms
 * each (~13 ms) and a digit-multiplexed cycle covers 4 digits at ~20 ms each
 * (~80 ms); 150 ms holds a full cycle with margin under solve-cadence jitter
 * while expiring well before any view change (status 1000 ms, alarm-time
 * 2500 ms), so a retuned digit stops ghosting its old segments.
 */
export const SEGMENT_PERSIST_MS = 150;

function popcount(value: number): number {
  let count = 0;
  let rest = value & 0xff;
  while (rest !== 0) {
    count += rest & 1;
    rest >>= 1;
  }
  return count;
}

export class SevenSegment {
  readonly digitCount: number;
  private readonly latched: Uint8Array;
  private readonly prevDigits: Uint8Array;
  private readonly lastSeg: Float64Array;
  private segSeen = false;
  private colonOn = false;
  /**
   * Last simulated millisecond each digit's each segment was observed lit.
   * Only maintained on the time-aware path (`update` with `nowMs`); the
   * timeless path keeps the original overwrite semantics for unit tests.
   */
  private readonly segSeenAt: Float64Array;

  constructor(digitCount = 4) {
    const count = Math.min(Math.max(Math.floor(digitCount), 1), 4);
    this.digitCount = count;
    this.latched = new Uint8Array(count);
    this.prevDigits = new Uint8Array(count);
    this.lastSeg = new Float64Array(8);
    this.segSeenAt = new Float64Array(count * 8).fill(Number.NEGATIVE_INFINITY);
  }

  /**
   * Feeds one solved step. `digitVolts` holds one entry per digit common and
   * `segVolts` eight entries in SEGMENT_ORDER — raw solved volts, so the
   * relative forward bias decides rather than an absolute level that sags.
   * `comVolts`/`clnVolts` carry the colon pair when the glass has one
   * (4-digit): COM high with CLN low lights it, active-low like the digits.
   * `nowMs` carries simulated time for segment-slice accumulation: without it
   * every asserted digit overwrites (the timeless unit-test path); with it a
   * single-segment slice accumulates per digit and expires after
   * SEGMENT_PERSIST_MS, while full patterns overwrite.
   */
  update(
    digitVolts: readonly number[],
    segVolts: readonly number[],
    comVolts?: number,
    clnVolts?: number,
    nowMs?: number,
  ): void {
    if (nowMs === undefined) {
      const segChanged =
        !this.segSeen || segVolts.some((value, index) => value !== this.lastSeg[index]);
      for (let digit = 0; digit < this.digitCount; digit++) {
        const now = (digitVolts[digit] ?? 0) >= DIGIT_THRESHOLD_VOLTS ? 1 : 0;
        if (now && (!this.prevDigits[digit] || segChanged)) {
          let mask = 0;
          for (let index = 0; index < 8; index++) {
            if ((digitVolts[digit] ?? 0) - (segVolts[index] ?? 0) > LIT_THRESHOLD_VOLTS) {
              mask |= 1 << index;
            }
          }
          this.latched[digit] = mask;
        }
        this.prevDigits[digit] = now;
      }
      this.segSeen = true;
      segVolts.forEach((value, index) => {
        this.lastSeg[index] = value;
      });
      if (comVolts !== undefined && clnVolts !== undefined) {
        this.colonOn = comVolts - clnVolts > LIT_THRESHOLD_VOLTS;
      }
      return;
    }

    for (let digit = 0; digit < this.digitCount; digit++) {
      const asserted = (digitVolts[digit] ?? 0) >= DIGIT_THRESHOLD_VOLTS;
      if (asserted) {
        let mask = 0;
        for (let index = 0; index < 8; index++) {
          if ((digitVolts[digit] ?? 0) - (segVolts[index] ?? 0) > LIT_THRESHOLD_VOLTS) {
            mask |= 1 << index;
          }
        }
        if (popcount(mask) === 1) {
          // One segment across whoever needs it: accumulate, keep the rest (no gallery build shows "-" or another G-only full pattern, so a G-only write is always a slice).
          this.latched[digit] |= mask;
          for (let index = 0; index < 8; index++) {
            if ((mask >> index) & 1) this.segSeenAt[digit * 8 + index] = nowMs;
          }
        } else {
          // A full pattern (or blank): overwrite, like digit multiplexing.
          this.latched[digit] = mask;
          for (let index = 0; index < 8; index++) {
            this.segSeenAt[digit * 8 + index] =
              (mask >> index) & 1 ? nowMs : Number.NEGATIVE_INFINITY;
          }
        }
      }
      this.prevDigits[digit] = asserted ? 1 : 0;
    }
    // Expire slices no solve has refreshed within the persistence window, so
    // a retuned digit stops ghosting its old segments. Overwritten digits
    // already cleared theirs above; this catches digits whose pattern moved
    // without an overwrite (segment-multiplexed view changes).
    for (let digit = 0; digit < this.digitCount; digit++) {
      for (let index = 0; index < 8; index++) {
        if (
          ((this.latched[digit] ?? 0) >> index) & 1 &&
          nowMs - (this.segSeenAt[digit * 8 + index] ?? Number.NEGATIVE_INFINITY) >
            SEGMENT_PERSIST_MS
        ) {
          this.latched[digit] &= ~(1 << index);
        }
      }
    }
    this.segSeen = true;
    segVolts.forEach((value, index) => {
      this.lastSeg[index] = value;
    });
    if (comVolts !== undefined && clnVolts !== undefined) {
      this.colonOn = comVolts - clnVolts > LIT_THRESHOLD_VOLTS;
    }
  }

  /** Whether the colon is currently lit (4-digit glass only). */
  get colonLit(): boolean {
    return this.colonOn;
  }

  /** Latched lit-masks, one byte per digit in SEGMENT_ORDER bit order. */
  patterns(): Uint8Array {
    return this.latched.slice();
  }

  /** Decoded characters, for tests and readouts. DP is blink state, not text. */
  getText(): string {
    let out = '';
    for (let digit = 0; digit < this.digitCount; digit++) {
      const pattern = this.latched[digit] & 0x7f;
      let char = ' ';
      for (const [candidate, bits] of Object.entries(SEGMENT_MAP)) {
        if (bits === pattern) {
          char = candidate;
          break;
        }
      }
      out += char;
    }
    return out;
  }

  /** Blanks every digit. */
  clear(): void {
    this.latched.fill(0);
    this.prevDigits.fill(0);
    this.segSeen = false;
    this.segSeenAt.fill(Number.NEGATIVE_INFINITY);
    this.colonOn = false;
  }
}
