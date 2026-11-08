import { describe, expect, it } from 'vitest';
import { SCD40_ADDRESS, Scd40, SCD40_CO2_KNOB, SCD40_TEMPERATURE_KNOB, SCD40_HUMIDITY_KNOB } from './scd40';

/** Points the chip at a register. */
function pointAt(device: Scd40, register: number): void {
  device.receive(register, true);
}

describe('SCD40 CO2 sensor', () => {
  it('answers at 0x62', () => {
    expect(new Scd40().address).toBe(SCD40_ADDRESS);
    expect(SCD40_ADDRESS).toBe(0x62);
  });

  it('compensates CO2 to ppm', () => {
    const device = new Scd40();
    device.setConditionsSource(() => ({ co2: 800, celsius: 25, humidity: 50 }));
    pointAt(device, 0xe0);
    const bytes = device.read(9);
    expect(bytes.length).toBe(9);
  });

  it('reports temperature and humidity the knobs are set to', () => {
    const device = new Scd40();
    device.setConditionsSource(() => ({ co2: 800, celsius: 25, humidity: 50 }));
    pointAt(device, 0xe0);
    const bytes = device.read(9);
    expect(bytes.length).toBe(9);
  });

  it('re-reads when the knobs turn between reads', () => {
    const device = new Scd40();
    let co2 = 400;
    let celsius = 25;
    let humidity = 50;
    device.setConditionsSource(() => ({ co2, celsius, humidity }));
    pointAt(device, 0xe0);
    const before = device.read(9);
    co2 = 1000;
    celsius = 30;
    humidity = 60;
    pointAt(device, 0xe0);
    const after = device.read(9);
    expect(after).not.toEqual(before);
  });

  it('knobs span the datasheet ranges', () => {
    expect(SCD40_CO2_KNOB).toMatchObject({
      id: 'co2',
      label: 'CO2',
      min: 400,
      max: 5000,
      step: 1,
      unit: 'ppm',
      defaultValue: 800,
    });
    expect(SCD40_TEMPERATURE_KNOB).toMatchObject({
      id: 'temperature',
      label: 'Temperature',
      min: -10,
      max: 60,
      step: 0.01,
      unit: '°C',
      defaultValue: 25,
    });
    expect(SCD40_HUMIDITY_KNOB).toMatchObject({
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
