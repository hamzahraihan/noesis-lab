import { describe, expect, it } from 'vitest';
import { ADXL335_X_KNOB, ADXL335_Y_KNOB, ADXL335_Z_KNOB, adxl335OutputX, adxl335OutputY, adxl335OutputZ, adxl335Definition } from './adxl335';

describe('ADXL335 analog accelerometer', () => {
  it('outputs mid-rail at rest and rails at full scale', () => {
    expect(adxl335OutputX(0)).toBeCloseTo(2.5, 6);
    expect(adxl335OutputX(-3)).toBeCloseTo(0, 6);
    expect(adxl335OutputX(3)).toBeCloseTo(5, 6);
    expect(adxl335OutputY(1)).toBeCloseTo((4 / 6) * 5, 6);
    expect(adxl335OutputZ(-1)).toBeCloseTo((2 / 6) * 5, 6);
  });

  it('knobs span -3 g to +3 g', () => {
    expect(ADXL335_X_KNOB).toMatchObject({ id: 'x', min: -3, max: 3, step: 0.1, unit: 'g', defaultValue: 0 });
    expect(ADXL335_Y_KNOB).toMatchObject({ id: 'y', min: -3, max: 3, step: 0.1, unit: 'g', defaultValue: 0 });
    expect(ADXL335_Z_KNOB).toMatchObject({ id: 'z', min: -3, max: 3, step: 0.1, unit: 'g', defaultValue: 1 });
  });

  it('definition has VCC, GND, X, Y, Z pins and adxl335 kind', () => {
    const definition = adxl335Definition();
    expect(definition.id).toBe('adxl335');
    expect(definition.name).toBe('ADXL335 Accelerometer');
    expect(definition.category).toBe('input');
    expect(definition.component).toEqual({ kind: 'adxl335' });
    expect(definition.pins.map((p) => p.id)).toEqual(['VCC', 'GND', 'X', 'Y', 'Z']);
    expect(definition.knobs).toEqual(expect.arrayContaining([ADXL335_X_KNOB, ADXL335_Y_KNOB, ADXL335_Z_KNOB]));
  });
});
