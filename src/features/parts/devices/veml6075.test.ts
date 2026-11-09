import { describe, expect, it } from 'vitest';
import { VEML6075_UVA_KNOB, VEML6075_UVB_KNOB, Veml6075 } from './veml6075';

describe('VEML6075 UV sensor', () => {
  it('reports UVA and UVB counts', () => {
    const sensor = new Veml6075();
    sensor.setUvSource(() => ({ uva: 200, uvb: 100 }));
    sensor.receive(0x01, true);
    const bytes = sensor.read(4);
    const uva = bytes[0]! | (bytes[1]! << 8);
    const uvb = bytes[2]! | (bytes[3]! << 8);
    expect(uva).toBe(200);
    expect(uvb).toBe(100);
  });

  it('reports device ID 0x26', () => {
    const sensor = new Veml6075();
    sensor.receive(0x07, true);
    const bytes = sensor.read(1);
    expect(bytes[0]).toBe(0x26);
  });

  it('knobs carry the sensor range', () => {
    expect(VEML6075_UVA_KNOB).toMatchObject({
      id: 'uva',
      label: 'UVA',
      min: 0,
      max: 65535,
      step: 1,
      unit: 'count',
      defaultValue: 100,
    });
    expect(VEML6075_UVB_KNOB).toMatchObject({
      id: 'uvb',
      label: 'UVB',
      min: 0,
      max: 65535,
      step: 1,
      unit: 'count',
      defaultValue: 50,
    });
  });
});
