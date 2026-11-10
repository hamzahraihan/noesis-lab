import { describe, expect, it } from 'vitest';
import { MAX30100_HEART_RATE_KNOB, MAX30100_SPO2_KNOB, Max30100 } from './max30100';

describe('MAX30100 pulse oximeter', () => {
  it('reports IR and red counts', () => {
    const sensor = new Max30100();
    sensor.setConditionsSource(() => ({ heartRate: 72, spo2: 98 }));
    sensor.receive(0x05, true);
    const bytes = sensor.read(4);
    const ir = (bytes[0]! << 8) | bytes[1]!;
    const red = (bytes[2]! << 8) | bytes[3]!;
    expect(ir).toBe(72 * 16);
    expect(red).toBe(98 * 16);
  });

  it('reports part ID 0x11', () => {
    const sensor = new Max30100();
    sensor.receive(0xff, true);
    const bytes = sensor.read(1);
    expect(bytes[0]).toBe(0x11);
  });

  it('knobs carry the sensor range', () => {
    expect(MAX30100_HEART_RATE_KNOB).toMatchObject({
      id: 'heartRate',
      label: 'Heart rate',
      min: 40,
      max: 180,
      step: 1,
      unit: 'bpm',
      defaultValue: 72,
    });
    expect(MAX30100_SPO2_KNOB).toMatchObject({
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
