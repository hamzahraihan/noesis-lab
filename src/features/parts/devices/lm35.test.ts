import { describe, expect, it } from 'vitest';
import { LM35_TEMPERATURE_KNOB, lm35Output, lm35Definition } from './lm35';

describe('LM35 analog temperature sensor', () => {
  it('outputs 10 mV per degree Celsius above ground', () => {
    expect(lm35Output(25)).toBeCloseTo(0.25, 6);
    expect(lm35Output(100)).toBeCloseTo(1.0, 6);
    expect(lm35Output(0)).toBeCloseTo(0, 6);
    expect(lm35Output(-40)).toBeCloseTo(-0.4, 6);
    expect(lm35Output(150)).toBeCloseTo(1.5, 6);
  });

  it('knob spans the datasheet range', () => {
    expect(LM35_TEMPERATURE_KNOB).toMatchObject({
      id: 'temperature',
      label: 'Temperature',
      min: -55,
      max: 150,
      step: 1,
      unit: '°C',
      defaultValue: 25,
    });
  });

  it('definition has VCC, GND, Vout pins and lm35 component kind', () => {
    const definition = lm35Definition();
    expect(definition.id).toBe('lm35');
    expect(definition.name).toBe('LM35 Temperature Sensor');
    expect(definition.category).toBe('input');
    expect(definition.component).toEqual({ kind: 'lm35' });
    expect(definition.pins.map((p) => p.id)).toEqual(['VCC', 'GND', 'Vout']);
    expect(definition.knobs).toContainEqual(LM35_TEMPERATURE_KNOB);
  });
});
