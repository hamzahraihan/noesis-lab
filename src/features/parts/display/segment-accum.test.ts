import { describe, expect, it } from 'vitest';
import { SevenSegment } from '@/features/parts/display/sevensegment';

function segVoltsFor(mask: number): number[] {
  // Common-anode: digit HIGH (5V), lit segment LOW (0V), dark HIGH (5V).
  return Array.from({ length: 8 }, (_, i) => ((mask >> i) & 1 ? 0 : 5));
}

describe('segment-multiplex accumulation', () => {
  it('holds a full digit from single-segment slices', () => {
    const c = new SevenSegment(4);
    // "0" needs A-F (0x3F), never G. Like SevSeg segmentOn, only digits
    // needing the segment assert; G lights nobody.
    const needs = [
      [1, 1, 1, 1], // A
      [1, 1, 1, 1], // B
      [1, 1, 1, 1], // C
      [1, 1, 1, 1], // D
      [1, 1, 1, 1], // E
      [1, 1, 1, 1], // F
      [0, 0, 0, 0], // G: nobody
    ];
    let t = 0;
    for (let seg = 0; seg < 7; seg++) {
      const digitVolts = needs[seg]!.map((v) => (v ? 5 : 0));
      c.update(digitVolts, segVoltsFor(1 << seg), undefined, undefined, t);
      t += 2;
    }
    expect(c.getText()).toBe('0000');
  });

  it('shows 0001 from segment slices', () => {
    const c = new SevenSegment(4);
    let t = 1000;
    // Segments A-G one at a time. Digits 0-2 are "0" (A-F), digit 3 is "1" (B,C).
    const needs = [
      [1, 1, 1, 0], // A: digits 0,1,2
      [1, 1, 1, 1], // B: all
      [1, 1, 1, 1], // C: all
      [1, 1, 1, 0], // D: 0,1,2
      [1, 1, 1, 0], // E: 0,1,2
      [1, 1, 1, 0], // F: 0,1,2
      [0, 0, 0, 0], // G: none
    ];
    for (let seg = 0; seg < 7; seg++) {
      const digitVolts = needs[seg]!.map((v) => (v ? 5 : 0));
      c.update(digitVolts, segVoltsFor(1 << seg), undefined, undefined, t);
      t += 2;
    }
    expect(c.getText()).toBe('0001');
  });

  it('expires old segments after a view change', () => {
    const c = new SevenSegment(4);
    const zeroNeeds = [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
    ];
    let t = 0;
    for (let seg = 0; seg < 7; seg++) {
      const digitVolts = zeroNeeds[seg]!.map((v) => (v ? 5 : 0));
      c.update(digitVolts, segVoltsFor(1 << seg), undefined, undefined, t);
      t += 2;
    }
    expect(c.getText()).toBe('0000');
    // View changes to "0001": only B,C slices touch digit 3 from now on.
    // After the persistence window, digit 3 must read "1", not ghost "0".
    const oneNeeds = [
      [1, 1, 1, 0], // A
      [1, 1, 1, 1], // B
      [1, 1, 1, 1], // C
      [1, 1, 1, 0], // D
      [1, 1, 1, 0], // E
      [1, 1, 1, 0], // F
      [0, 0, 0, 0], // G
    ];
    for (let seg = 0; seg < 7; seg++) {
      const digitVolts = oneNeeds[seg]!.map((v) => (v ? 5 : 0));
      c.update(digitVolts, segVoltsFor(1 << seg), undefined, undefined, t);
      t += 2;
    }
    // Immediately after the change cycle, old A,D,E,F may still persist on
    // digit 3. Keep running full "0001" cycles past the persistence window:
    // digits 0-2 keep seeing A-F, digit 3 only ever sees B,C, so its old
    // segments expire and it settles to "1".
    for (let round = 0; round < 15; round++) {
      for (let seg = 0; seg < 7; seg++) {
        const digitVolts = oneNeeds[seg]!.map((v) => (v ? 5 : 0));
        c.update(digitVolts, segVoltsFor(1 << seg), undefined, undefined, t);
        t += 2;
      }
    }
    expect(c.getText()).toBe('0001');
  });
});
