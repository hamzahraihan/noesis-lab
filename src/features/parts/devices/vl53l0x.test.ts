import { describe, expect, it } from 'vitest';
import { VL53L0X_ADDRESS, Vl53l0x, VL53L0X_DISTANCE_KNOB } from './vl53l0x';

/** Points the chip at a register. */
function pointAt(device: Vl53l0x, register: number): void {
  device.receive(register, true);
}

describe('VL53L0X time-of-flight distance sensor', () => {
  it('answers at 0x29', () => {
    expect(new Vl53l0x().address).toBe(VL53L0X_ADDRESS);
    expect(VL53L0X_ADDRESS).toBe(0x29);
  });

  it('reports the chip id register', () => {
    const device = new Vl53l0x();
    pointAt(device, 0x00);
    expect(device.read(1)).toEqual([0xEE]);
  });

  it('reports the distance the knob is set to', () => {
    const device = new Vl53l0x();
    device.setDistanceSource(() => 1200);
    pointAt(device, 0x14);
    const bytes = device.read(2);
    expect(bytes.length).toBe(2);
    // 1200 mm = 0x04B0, big-endian.
    expect(bytes).toEqual([0x04, 0xB0]);
  });

  it('re-reads when the knob turns between reads', () => {
    const device = new Vl53l0x();
    let distance = 500;
    device.setDistanceSource(() => distance);
    pointAt(device, 0x14);
    const before = device.read(2);
    distance = 2000;
    pointAt(device, 0x14);
    const after = device.read(2);
    expect(after).not.toEqual(before);
  });

  it('knob spans the datasheet range', () => {
    expect(VL53L0X_DISTANCE_KNOB).toMatchObject({
      id: 'distance',
      label: 'Distance',
      min: 0,
      max: 2000,
      step: 1,
      unit: 'mm',
      defaultValue: 500,
    });
  });
});
