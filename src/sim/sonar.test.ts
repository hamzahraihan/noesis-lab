import { describe, expect, it } from 'vitest';
import { DISTANCE_KNOB, echoMicroseconds, sonarDefinition } from './sonar';

describe('sonar definition', () => {
  it('exposes VCC/TRIG/ECHO/GND with a distance knob', () => {
    const def = sonarDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['VCC', 'TRIG', 'ECHO', 'GND']);
    expect([DISTANCE_KNOB.min, DISTANCE_KNOB.max, DISTANCE_KNOB.step, DISTANCE_KNOB.defaultValue]).toEqual([2, 400, 1, 100]);
  });
});

describe('echo math', () => {
  it('converts distance to echo microseconds at 58 per cm', () => {
    expect(echoMicroseconds(2)).toBe(116);
    expect(echoMicroseconds(100)).toBe(5800);
  });
});
