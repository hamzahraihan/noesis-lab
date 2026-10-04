import { describe, expect, it } from 'vitest';
import { DIGIT_KNOB, dialerDefinition } from './dialer';

describe('dialer definition', () => {
  it('exposes GND/DIAL/PULSE with a digit knob', () => {
    const def = dialerDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['GND', 'DIAL', 'PULSE']);
    expect(def.knobs).toEqual([DIGIT_KNOB]);
    expect([def.widthMm, def.heightMm]).toEqual([70.4, 75.6]);
  });
});
