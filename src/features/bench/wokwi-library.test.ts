import { describe, expect, it } from 'vitest';
import { WOKWI_LIBRARY } from './wokwi-library';

describe('wokwi library mega entry', () => {
  it('lists the Mega element as placed', () => {
    const entry = WOKWI_LIBRARY.find((e) => e.tag === 'wokwi-arduino-mega');
    expect(entry?.status).toBe('placed');
    expect(entry?.sizeMm).toEqual({ w: 102.66, h: 50.8 });
  });
});
