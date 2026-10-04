import { describe, expect, it } from 'vitest';
import { SD_CARD_BYTES, microsdDefinition } from './sdcard';

describe('microsd definition', () => {
  it('exposes the seven breakout pins', () => {
    const def = microsdDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['CD', 'DO', 'GND', 'SCK', 'VCC', 'DI', 'CS']);
    expect([def.widthMm, def.heightMm]).toEqual([21.6, 20.4]);
    expect(SD_CARD_BYTES).toBe(1048576);
  });
});
