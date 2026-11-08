import { describe, expect, it } from 'vitest';
import { MOISTURE_KNOB, soilMoistureOutput, soilMoistureDefinition } from './soil-moisture';

describe('Soil moisture sensor', () => {
  it('outputs a voltage proportional to moisture', () => {
    expect(soilMoistureOutput(0)).toBeCloseTo(0, 6);
    expect(soilMoistureOutput(50)).toBeCloseTo(2.5, 6);
    expect(soilMoistureOutput(100)).toBeCloseTo(5, 6);
  });

  it('knob spans 0 to 100 percent', () => {
    expect(MOISTURE_KNOB).toMatchObject({
      id: 'moisture',
      label: 'Moisture',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 30,
    });
  });

  it('definition has VCC, GND, AOUT pins and analog output kind', () => {
    const definition = soilMoistureDefinition();
    expect(definition.id).toBe('soil-moisture');
    expect(definition.name).toBe('Soil Moisture Sensor');
    expect(definition.category).toBe('input');
    expect(definition.component).toEqual({ kind: 'soil-moisture' });
    expect(definition.pins.map((p) => p.id)).toEqual(['VCC', 'GND', 'AOUT']);
    expect(definition.knobs).toContainEqual(MOISTURE_KNOB);
  });
});
