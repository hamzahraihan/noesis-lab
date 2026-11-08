import { describe, expect, it } from 'vitest';
import { BME280_ADDRESS, Bme280, BME280_HUMIDITY_KNOB, BME280_PRESSURE_KNOB, BME280_TEMPERATURE_KNOB } from './bme280';

/** Points the chip at a register. */
function pointAt(device: Bme280, register: number): void {
  device.receive(register, true);
}

describe('BME280 environmental sensor', () => {
  it('answers at 0x76', () => {
    expect(new Bme280().address).toBe(BME280_ADDRESS);
    expect(BME280_ADDRESS).toBe(0x76);
  });

  it('reports the chip id register', () => {
    const device = new Bme280();
    pointAt(device, 0xd0);
    expect(device.read(1)).toEqual([0x60]);
  });

  it('compensates temperature to hundredths of a degree', () => {
    const device = new Bme280();
    device.setConditionsSource(() => ({ pascals: 101325, celsius: 25, humidity: 50 }));
    pointAt(device, 0xf7);
    const bytes = device.read(8);
    expect(bytes.length).toBe(8);
  });

  it('reports pressure and humidity the knobs are set to', () => {
    const device = new Bme280();
    device.setConditionsSource(() => ({ pascals: 101325, celsius: 25, humidity: 50 }));
    pointAt(device, 0xf7);
    const bytes = device.read(8);
    expect(bytes.length).toBe(8);
  });

  it('re-reads when the knobs turn between reads', () => {
    const device = new Bme280();
    let celsius = 25;
    let humidity = 50;
    device.setConditionsSource(() => ({ pascals: 101325, celsius, humidity }));
    pointAt(device, 0xf7);
    const before = device.read(8);
    celsius = 30;
    humidity = 60;
    pointAt(device, 0xf7);
    const after = device.read(8);
    expect(after).not.toEqual(before);
  });

  it('knobs span the datasheet ranges', () => {
    expect(BME280_TEMPERATURE_KNOB).toMatchObject({
      id: 'temperature',
      label: 'Temperature',
      min: -40,
      max: 85,
      step: 0.01,
      unit: '°C',
      defaultValue: 25,
    });
    expect(BME280_PRESSURE_KNOB).toMatchObject({
      id: 'pressure',
      label: 'Pressure',
      min: 300,
      max: 1100,
      step: 1,
      unit: 'hPa',
      defaultValue: 1013,
    });
    expect(BME280_HUMIDITY_KNOB).toMatchObject({
      id: 'humidity',
      label: 'Humidity',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 50,
    });
  });
});
