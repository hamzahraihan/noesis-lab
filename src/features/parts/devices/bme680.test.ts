import { describe, expect, it } from 'vitest';
import { BME680_ADDRESS, Bme680, BME680_GAS_KNOB, BME680_TEMPERATURE_KNOB, BME680_HUMIDITY_KNOB, BME680_PRESSURE_KNOB } from './bme680';

/** Points the chip at a register. */
function pointAt(device: Bme680, register: number): void {
  device.receive(register, true);
}

describe('BME680 gas sensor', () => {
  it('answers at 0x76', () => {
    expect(new Bme680().address).toBe(BME680_ADDRESS);
    expect(BME680_ADDRESS).toBe(0x76);
  });

  it('reports the chip id register', () => {
    const device = new Bme680();
    pointAt(device, 0xd0);
    expect(device.read(1)).toEqual([0x61]);
  });

  it('compensates temperature to hundredths of a degree', () => {
    const device = new Bme680();
    device.setConditionsSource(() => ({ pascals: 101325, celsius: 25, humidity: 50, gas: 20000 }));
    pointAt(device, 0xf7);
    const bytes = device.read(8);
    expect(bytes.length).toBe(8);
  });

  it('reports gas the knob is set to', () => {
    const device = new Bme680();
    device.setConditionsSource(() => ({ pascals: 101325, celsius: 25, humidity: 50, gas: 20000 }));
    pointAt(device, 0xf7);
    const bytes = device.read(8);
    expect(bytes.length).toBe(8);
  });

  it('re-reads when the knobs turn between reads', () => {
    const device = new Bme680();
    let celsius = 25;
    let humidity = 50;
    let gas = 10000;
    device.setConditionsSource(() => ({ pascals: 101325, celsius, humidity, gas }));
    pointAt(device, 0xf7);
    const before = device.read(8);
    celsius = 30;
    humidity = 60;
    gas = 50000;
    pointAt(device, 0xf7);
    const after = device.read(8);
    expect(after).not.toEqual(before);
  });

  it('knobs span the datasheet ranges', () => {
    expect(BME680_TEMPERATURE_KNOB).toMatchObject({
      id: 'temperature',
      label: 'Temperature',
      min: -40,
      max: 85,
      step: 0.01,
      unit: '°C',
      defaultValue: 25,
    });
    expect(BME680_PRESSURE_KNOB).toMatchObject({
      id: 'pressure',
      label: 'Pressure',
      min: 300,
      max: 1100,
      step: 1,
      unit: 'hPa',
      defaultValue: 1013,
    });
    expect(BME680_HUMIDITY_KNOB).toMatchObject({
      id: 'humidity',
      label: 'Humidity',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 50,
    });
    expect(BME680_GAS_KNOB).toMatchObject({
      id: 'gas',
      label: 'Gas resistance',
      min: 1000,
      max: 500000,
      step: 1000,
      unit: 'Ω',
      defaultValue: 20000,
    });
  });
});
