import { describe, expect, it } from 'vitest';
import { SGP30_ECO2_KNOB, SGP30_TVOC_KNOB, Sgp30 } from './sgp30';

describe('SGP30 air quality sensor', () => {
  it('reports eCO2 and TVOC as raw words', () => {
    const sensor = new Sgp30();
    sensor.setAirSource(() => ({ eco2: 500, tvoc: 50 }));
    // Init
    sensor.receive(0x20, true);
    sensor.receive(0x03, false);
    // Measure
    sensor.receive(0x20, true);
    sensor.receive(0x08, false);
    const bytes = sensor.read(6);
    const eco2 = (bytes[0]! << 8) | bytes[1]!;
    const tvoc = (bytes[3]! << 8) | bytes[4]!;
    expect(eco2).toBe(500);
    expect(tvoc).toBe(50);
  });

  it('knobs carry the sensor range', () => {
    expect(SGP30_ECO2_KNOB).toMatchObject({
      id: 'eco2',
      label: 'eCO2',
      min: 400,
      max: 60000,
      step: 1,
      unit: 'ppm',
      defaultValue: 400,
    });
    expect(SGP30_TVOC_KNOB).toMatchObject({
      id: 'tvoc',
      label: 'TVOC',
      min: 0,
      max: 60000,
      step: 1,
      unit: 'ppb',
      defaultValue: 0,
    });
  });
});
