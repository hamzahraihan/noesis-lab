import { describe, expect, it } from 'vitest';
import { MQ2_KNOB, mq2OutputVolts, mq2Definition } from './mq2';

describe('MQ-2 gas sensor', () => {
  it('outputs a voltage proportional to gas concentration', () => {
    expect(mq2OutputVolts(0)).toBeCloseTo(0, 6);
    expect(mq2OutputVolts(500)).toBeCloseTo(2.5, 6);
    expect(mq2OutputVolts(1000)).toBeCloseTo(5, 6);
  });

  it('knob spans the datasheet range', () => {
    expect(MQ2_KNOB).toMatchObject({
      id: 'gas',
      label: 'Gas concentration',
      min: 0,
      max: 1000,
      step: 1,
      unit: 'ppm',
      defaultValue: 100,
    });
  });

  it('definition has VCC, GND, AOUT pins and gas-sensor kind', () => {
    const definition = mq2Definition();
    expect(definition.id).toBe('mq2');
    expect(definition.name).toBe('MQ-2 Gas Sensor');
    expect(definition.category).toBe('input');
    expect(definition.component).toEqual({ kind: 'gas-sensor' });
    expect(definition.pins.map((p) => p.id)).toEqual(['VCC', 'GND', 'AOUT']);
    expect(definition.knobs).toEqual(expect.arrayContaining([MQ2_KNOB]));
  });
});
