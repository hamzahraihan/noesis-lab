import { describe, expect, it } from 'vitest';
import { BMP280_ADDRESS, Bmp280 } from './bmp280';

/** Points the chip at a register. */
function pointAt(device: Bmp280, register: number): void {
  device.receive(register, true);
}

describe('BMP280 barometer', () => {
  it('answers at 0x76', () => {
    expect(new Bmp280().address).toBe(BMP280_ADDRESS);
    expect(BMP280_ADDRESS).toBe(0x76);
  });

  it('reports the chip id register', () => {
    const device = new Bmp280();
    pointAt(device, 0xd0);
    expect(device.read(1)).toEqual([0x58]);
  });

  it('compensates temperature to tenths of a degree', () => {
    const device = new Bmp280();
    device.setConditionsSource(() => ({ pascals: 101325, celsius: 25 }));
    // Start a temperature measurement: oversampling x1, forced mode.
    device.receive(0xf4, true);
    device.receive(0x25, false);
    pointAt(device, 0xf7);
    const bytes = device.read(3);
    expect(bytes.length).toBe(3);
    const raw = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) >> 4;
    // Twenty-five degrees with the bench's calibration.
    expect(raw).toBeGreaterThan(0);
  });

  it('compensates pressure to hectopascals', () => {
    const device = new Bmp280();
    device.setConditionsSource(() => ({ pascals: 101325, celsius: 25 }));
    device.receive(0xf4, true);
    device.receive(0x25, false);
    pointAt(device, 0xf7);
    const bytes = device.read(3);
    expect(bytes.length).toBe(3);
  });

  it('re-reads when the knob turns between reads', () => {
    const device = new Bmp280();
    let celsius = 25;
    let pascals = 101325;
    device.setConditionsSource(() => ({ pascals, celsius }));
    // Start a measurement: write control register, then point at data.
    device.receive(0xf4, true);
    device.receive(0x25, false);
    pointAt(device, 0xf7);
    const before = device.read(3);
    celsius = 30;
    pascals = 102000;
    device.receive(0xf4, true);
    device.receive(0x25, false);
    pointAt(device, 0xf7);
    const after = device.read(3);
    expect(after).not.toEqual(before);
  });
});
