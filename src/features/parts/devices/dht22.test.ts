import { describe, expect, it } from 'vitest';
import { DHT22_HUMIDITY_KNOB, DHT22_TEMPERATURE_KNOB, dht22Definition, dht22Humidity, dht22Temperature } from './dht22';

describe('DHT22 temperature and humidity sensor', () => {
  it('outputs Celsius within the datasheet range', () => {
    expect(dht22Temperature(0)).toBeCloseTo(0, 6);
    expect(dht22Temperature(25)).toBeCloseTo(25, 6);
    expect(dht22Temperature(50)).toBeCloseTo(50, 6);
  });

  it('outputs a humidity percentage in 0 to 100', () => {
    expect(dht22Humidity(0)).toBeCloseTo(0, 6);
    expect(dht22Humidity(50)).toBeCloseTo(50, 6);
    expect(dht22Humidity(100)).toBeCloseTo(100, 6);
  });

  it('knobs carry the sensor range', () => {
    expect(DHT22_TEMPERATURE_KNOB).toMatchObject({
      id: 'temperature',
      label: 'Temperature',
      min: 0,
      max: 50,
      step: 0.1,
      unit: '°C',
      defaultValue: 20,
    });
    expect(DHT22_HUMIDITY_KNOB).toMatchObject({
      id: 'humidity',
      label: 'Humidity',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 50,
    });
  });

  it('definition has VCC, GND, and DATA pins', () => {
    const definition = dht22Definition();
    expect(definition.id).toBe('dht22');
    expect(definition.name).toBe('DHT22 Temp/Humidity');
    expect(definition.category).toBe('input');
    expect(definition.component).toEqual({ kind: 'dht22' });
    expect(definition.pins.map((p) => p.id)).toEqual(['VCC', 'GND', 'DATA']);
  });
});
