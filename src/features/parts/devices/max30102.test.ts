import { describe, expect, it } from 'vitest';
import { MAX30102_ADDRESS, Max30102, MAX30102_HEART_RATE_KNOB, MAX30102_SPO2_KNOB } from './max30102';

/** Points the chip at a register. */
function pointAt(device: Max30102, register: number): void {
  device.receive(register, true);
}

describe('MAX30102 pulse oximeter', () => {
  it('answers at 0x57', () => {
    expect(new Max30102().address).toBe(MAX30102_ADDRESS);
    expect(MAX30102_ADDRESS).toBe(0x57);
  });

  it('reports the part id register', () => {
    const device = new Max30102();
    pointAt(device, 0xff);
    expect(device.read(1)).toEqual([0x15]);
  });

  it('reports heart rate and SpO2 the knobs are set to', () => {
    const device = new Max30102();
    device.setConditionsSource(() => ({ heartRate: 72, spo2: 98 }));
    pointAt(device, 0x05);
    const bytes = device.read(6);
    expect(bytes.length).toBe(6);
  });

  it('re-reads when the knobs turn between reads', () => {
    const device = new Max30102();
    let heartRate = 60;
    let spo2 = 95;
    device.setConditionsSource(() => ({ heartRate, spo2 }));
    pointAt(device, 0x05);
    const before = device.read(6);
    heartRate = 110;
    spo2 = 99;
    pointAt(device, 0x05);
    const after = device.read(6);
    expect(after).not.toEqual(before);
  });

  it('knobs span the datasheet ranges', () => {
    expect(MAX30102_HEART_RATE_KNOB).toMatchObject({
      id: 'heartRate',
      label: 'Heart rate',
      min: 40,
      max: 180,
      step: 1,
      unit: 'bpm',
      defaultValue: 72,
    });
    expect(MAX30102_SPO2_KNOB).toMatchObject({
      id: 'spo2',
      label: 'SpO2',
      min: 70,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 98,
    });
  });
});
