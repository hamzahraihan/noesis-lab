import { describe, expect, it } from 'vitest';
import { SI7021_TEMPERATURE_KNOB, SI7021_HUMIDITY_KNOB, Si7021 } from './si7021';

describe('SI7021 temperature and humidity sensor', () => {
  it('reports humidity as a raw word', () => {
    const sensor = new Si7021();
    sensor.setConditionsSource(() => ({ celsius: 21, humidity: 50 }));
    sensor.receive(0xf3, true);
    const bytes = sensor.read(3);
    const raw = (bytes[0]! << 8) | bytes[1]!;
    const rh = (raw * 125) / 65536 - 6;
    expect(rh).toBeCloseTo(50, 0);
  });

  it('reports temperature as a raw word', () => {
    const sensor = new Si7021();
    sensor.setConditionsSource(() => ({ celsius: 25, humidity: 50 }));
    sensor.receive(0xe0, true);
    const bytes = sensor.read(3);
    const raw = (bytes[0]! << 8) | bytes[1]!;
    const t = (raw * 175.72) / 65536 - 46.85;
    expect(t).toBeCloseTo(25, 0);
  });

  it('knobs carry the sensor range', () => {
    expect(SI7021_TEMPERATURE_KNOB).toMatchObject({
      id: 'temperature',
      label: 'Temperature',
      min: -10,
      max: 85,
      step: 0.1,
      unit: '°C',
      defaultValue: 21,
    });
    expect(SI7021_HUMIDITY_KNOB).toMatchObject({
      id: 'humidity',
      label: 'Humidity',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 45,
    });
  });
});
