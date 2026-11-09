import { describe, expect, it } from 'vitest';
import { CCS811_ECO2_KNOB, CCS811_TVOC_KNOB, Ccs811 } from './ccs811';

describe('CCS811 air quality sensor', () => {
  it('reports eCO2 and TVOC as raw words', () => {
    const sensor = new Ccs811();
    sensor.setAirSource(() => ({ eco2: 500, tvoc: 50 }));
    // Start application
    sensor.receive(0xf4, true);
    // Read ALG_RESULT_DATA
    sensor.receive(0x02, true);
    const bytes = sensor.read(4);
    const eco2 = (bytes[0]! << 8) | bytes[1]!;
    const tvoc = (bytes[2]! << 8) | bytes[3]!;
    expect(eco2).toBe(500);
    expect(tvoc).toBe(50);
  });

  it('reports hardware ID 0x81', () => {
    const sensor = new Ccs811();
    sensor.receive(0x20, true);
    const bytes = sensor.read(1);
    expect(bytes[0]).toBe(0x81);
  });

  it('knobs carry the sensor range', () => {
    expect(CCS811_ECO2_KNOB).toMatchObject({
      id: 'eco2',
      label: 'eCO2',
      min: 400,
      max: 8192,
      step: 1,
      unit: 'ppm',
      defaultValue: 400,
    });
    expect(CCS811_TVOC_KNOB).toMatchObject({
      id: 'tvoc',
      label: 'TVOC',
      min: 0,
      max: 1187,
      step: 1,
      unit: 'ppb',
      defaultValue: 0,
    });
  });
});
