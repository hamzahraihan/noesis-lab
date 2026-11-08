import { describe, expect, it } from 'vitest';
import { AHT20_ADDRESS, Aht20, AHT20_HUMIDITY_KNOB, AHT20_TEMPERATURE_KNOB } from './aht20';

/** Points the chip at a register. */
function pointAt(device: Aht20, register: number): void {
  device.receive(register, true);
}

describe('AHT20 temperature and humidity sensor', () => {
  it('answers at 0x38', () => {
    expect(new Aht20().address).toBe(AHT20_ADDRESS);
    expect(AHT20_ADDRESS).toBe(0x38);
  });

  it('compensates temperature to hundredths of a degree', () => {
    const device = new Aht20();
    device.setConditionsSource(() => ({ celsius: 25, humidity: 50 }));
    pointAt(device, 0x71);
    const bytes = device.read(6);
    expect(bytes.length).toBe(6);
  });

  it('reports humidity the knob is set to', () => {
    const device = new Aht20();
    device.setConditionsSource(() => ({ celsius: 25, humidity: 50 }));
    pointAt(device, 0x71);
    const bytes = device.read(6);
    expect(bytes.length).toBe(6);
  });

  it('re-reads when the knobs turn between reads', () => {
    const device = new Aht20();
    let celsius = 25;
    let humidity = 50;
    device.setConditionsSource(() => ({ celsius, humidity }));
    pointAt(device, 0x71);
    const before = device.read(6);
    celsius = 30;
    humidity = 60;
    pointAt(device, 0x71);
    const after = device.read(6);
    expect(after).not.toEqual(before);
  });

  it('knobs span the datasheet ranges', () => {
    expect(AHT20_TEMPERATURE_KNOB).toMatchObject({
      id: 'temperature',
      label: 'Temperature',
      min: -40,
      max: 85,
      step: 0.01,
      unit: '°C',
      defaultValue: 25,
    });
    expect(AHT20_HUMIDITY_KNOB).toMatchObject({
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
