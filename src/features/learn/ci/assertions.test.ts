import { describe, expect, it } from 'vitest';
import { checkHardware, parseHardwareAssertions, type HardwareSnapshot } from './assertions';

/** A bench whose hardware reads what the test wants it to. */
function snapshot(overrides: Partial<HardwareSnapshot> = {}): HardwareSnapshot {
  return {
    volts: () => 4.8,
    amps: () => 0.01,
    text: () => 'hardware ok',
    pixel: () => true,
    angle: () => 7.5,
    ...overrides,
  };
}

describe('checking a hardware assertion', () => {
  it('passes a voltage inside its range', () => {
    const result = checkHardware(
      { kind: 'volts', part: 'p1', pin: 'D13', min: 4, max: 5.5 },
      snapshot(),
    );

    expect(result).toEqual({ ok: true, name: 'volts p1:D13', detail: '' });
  });

  it('says what a voltage outside its range was', () => {
    const result = checkHardware(
      { kind: 'volts', part: 'p1', pin: 'D13', min: 4 },
      snapshot({ volts: () => 0.2 }),
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('expected at least 4 V on p1:D13, saw 0.2 V');
  });

  it('says when a pin is not in the circuit', () => {
    const result = checkHardware(
      { kind: 'volts', part: 'p1', pin: 'NOPE', min: 4 },
      snapshot({ volts: () => undefined }),
    );

    expect(result.detail).toBe('p1:NOPE is not a pin on the circuit');
  });

  it('checks current on a board pin', () => {
    const result = checkHardware({ kind: 'amps', pin: 'D13', min: 0.001 }, snapshot());

    expect(result).toEqual({ ok: true, name: 'amps D13', detail: '' });
  });

  it('says what a current outside its range was', () => {
    const result = checkHardware(
      { kind: 'amps', pin: 'D13', max: 0.001 },
      snapshot({ amps: () => 0.0145 }),
    );

    expect(result.detail).toBe('expected at most 0.001 A on D13, saw 0.015 A');
  });

  it('checks what a character LCD says', () => {
    const result = checkHardware({ kind: 'text', part: 'p4', contains: 'hardware ok' }, snapshot());

    expect(result).toEqual({ ok: true, name: 'text p4', detail: '' });
  });

  it('says what the LCD really showed', () => {
    const result = checkHardware(
      { kind: 'text', part: 'p4', contains: 'hardware ok' },
      snapshot({ text: () => '                ' }),
    );

    expect(result.detail).toBe('expected p4 to contain "hardware ok", saw "                "');
  });

  it('checks a lit pixel', () => {
    const result = checkHardware({ kind: 'pixel', part: 'p4', x: 1, y: 1, on: true }, snapshot());

    expect(result).toEqual({ ok: true, name: 'pixel p4 (1,1)', detail: '' });
  });

  it('says which pixel was wrong', () => {
    const result = checkHardware(
      { kind: 'pixel', part: 'p4', x: 1, y: 1, on: true },
      snapshot({ pixel: () => false }),
    );

    expect(result.detail).toBe('expected pixel (1,1) on p4 to be on, saw off');
  });

  it('checks a shaft angle inside its tolerance', () => {
    const result = checkHardware({ kind: 'angle', part: 'p6', degrees: 7.5 }, snapshot());

    expect(result).toEqual({ ok: true, name: 'angle p6', detail: '' });
  });

  it('says how far from the angle the shaft was', () => {
    const result = checkHardware(
      { kind: 'angle', part: 'p6', degrees: 7.5, tolerance: 0.6 },
      snapshot({ angle: () => 0 }),
    );

    expect(result.detail).toBe('expected p6 at 7.5 ± 0.6°, saw 0°');
  });

  it('says when a part cannot answer', () => {
    const result = checkHardware(
      { kind: 'angle', part: 'p6', degrees: 7.5 },
      snapshot({ angle: () => undefined }),
    );

    expect(result.detail).toBe('p6 is not a stepper');
  });
});

describe('reading hardware assertions', () => {
  it('reads every kind a project can declare', () => {
    const assertions = parseHardwareAssertions(
      [
        { kind: 'volts', part: 'p1', pin: 'D13', min: 4 },
        { kind: 'amps', pin: 'D13', min: 0.001 },
        { kind: 'text', part: 'p4', contains: 'hardware ok' },
        { kind: 'pixel', part: 'p4', x: 1, y: 1, on: true },
        { kind: 'angle', part: 'p6', degrees: 7.5, tolerance: 0.6 },
      ],
      120,
    );

    expect(assertions).toEqual([
      { kind: 'volts', part: 'p1', pin: 'D13', min: 4 },
      { kind: 'amps', pin: 'D13', min: 0.001 },
      { kind: 'text', part: 'p4', contains: 'hardware ok' },
      { kind: 'pixel', part: 'p4', x: 1, y: 1, on: true },
      { kind: 'angle', part: 'p6', degrees: 7.5, tolerance: 0.6 },
    ]);
  });

  it('defaults to no assertions when the project declares none', () => {
    expect(parseHardwareAssertions(undefined, 120)).toEqual([]);
  });

  it('rejects an assertion past the end of the run', () => {
    expect(() =>
      parseHardwareAssertions([{ kind: 'volts', part: 'p1', pin: 'D13', min: 4, at: 121 }], 120),
    ).toThrow('expect.json: hardware[0]: at must be between 1 and 120');
  });

  it('rejects a voltage with no bounds', () => {
    expect(() => parseHardwareAssertions([{ kind: 'volts', part: 'p1', pin: 'D13' }], 120)).toThrow(
      'expect.json: hardware[0]: volts needs min, max, or both',
    );
  });

  it('rejects an unknown kind', () => {
    expect(() => parseHardwareAssertions([{ kind: 'vibes' }], 120)).toThrow(
      'expect.json: hardware[0]: kind must be one of volts, amps, text, pixel, angle',
    );
  });

  it('rejects a pixel position that is not a whole coordinate', () => {
    expect(() =>
      parseHardwareAssertions([{ kind: 'pixel', part: 'p4', x: 1.5, y: 1, on: true }], 120),
    ).toThrow('expect.json: hardware[0]: x must be a whole number');
  });
});
