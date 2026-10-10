import { describe, expect, it } from 'vitest';
import { DIGIT_KNOB, dialerDefinition } from './dialer';
import { renderedSizeMm, wokwiPartFor } from '@/features/bench/wokwi/wokwi';

describe('dialer definition', () => {
  it('exposes GND/DIAL/PULSE with a digit knob', () => {
    const def = dialerDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['GND', 'DIAL', 'PULSE']);
    expect(def.knobs).toEqual([DIGIT_KNOB]);
    expect([def.widthMm, def.heightMm]).toEqual([70.4, 75.6]);
  });

  it('selection box matches the dialer artwork', () => {
    const drawn = renderedSizeMm(dialerDefinition());
    expect(drawn.widthMm).toBe(70.4);
    expect(drawn.heightMm).toBe(75.6);
    expect(wokwiPartFor(dialerDefinition())?.tag).toBe('wokwi-rotary-dialer');
  });
});
