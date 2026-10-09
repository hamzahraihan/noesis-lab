/**
 * 7-segment display state model: the digits behind the glass.
 *
 * The firmware multiplexes: exactly one digit common is high on any given
 * solve, while the glass renders every digit at once. This model latches
 * each digit's pattern while its common is asserted, so the renderer can
 * push the whole frame every time instead of depending on which digit a
 * render happens to sample — sampling render instants can never observe a
 * multiplexed state reliably.
 *
 * Latching is edge-triggered (rising common) plus a refresh when the segment
 * lines move under an asserted digit. The refresh keeps a statically-driven
 * single digit live; it cannot ghost across digits because a refresh only
 * ever touches a digit whose common is currently high, and correct firmware
 * blanks all commons before moving the segments — exactly as real hardware
 * requires.
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
  'A': 0b01110111,
  'b': 0b01111100,
  'C': 0b00111001,
  'c': 0b01011000,
  'D': 0b01111001,
  'd': 0b01011110,
  'E': 0b01111001,
  'F': 0b01110001,
  '-': 0b01000000,
  ' ': 0b00000000,
};

export class SevenSegment {
  readonly digitCount: number;
  private readonly latched: Uint8Array;
  private readonly prevDigits: Uint8Array;
  private readonly lastSeg: Float64Array;
  private segSeen = false;

  constructor(digitCount = 4) {
    const count = Math.min(Math.max(Math.floor(digitCount), 1), 4);
    this.digitCount = count;
    this.latched = new Uint8Array(count);
    this.prevDigits = new Uint8Array(count);
    this.lastSeg = new Float64Array(8);
  }

  /**
   * Feeds one solved step. `digitVolts` holds one entry per digit common and
   * `segVolts` eight entries in SEGMENT_ORDER — raw solved volts, so the
   * relative forward bias decides rather than an absolute level that sags.
   */
  update(digitVolts: readonly number[], segVolts: readonly number[]): void {
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
  }
}
