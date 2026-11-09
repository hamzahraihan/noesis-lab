import { describe, expect, it } from 'vitest';
import { HMC5883L_X_KNOB, HMC5883L_Y_KNOB, HMC5883L_Z_KNOB, Hmc5883l } from './hmc5883l';

describe('HMC5883L magnetometer', () => {
  it('reports X field as a raw word', () => {
    const sensor = new Hmc5883l();
    sensor.setFieldSource(() => ({ x: 1, y: 0, z: 0 }));
    sensor.receive(0x03, true);
    const bytes = sensor.read(2);
    const raw = (bytes[0]! << 8) | bytes[1]!;
    const g = (raw * 0.92) / 1000;
    expect(g).toBeCloseTo(1, 1);
  });

  it('reports device ID H43', () => {
    const sensor = new Hmc5883l();
    sensor.receive(0x0a, true);
    const bytes = sensor.read(3);
    expect(bytes[0]).toBe(0x48);
    expect(bytes[1]).toBe(0x34);
    expect(bytes[2]).toBe(0x33);
  });

  it('knobs carry the sensor range', () => {
    expect(HMC5883L_X_KNOB).toMatchObject({
      id: 'x',
      label: 'X field',
      min: -2,
      max: 2,
      step: 0.01,
      unit: 'G',
      defaultValue: 0,
    });
    expect(HMC5883L_Y_KNOB).toMatchObject({
      id: 'y',
      label: 'Y field',
      min: -2,
      max: 2,
      step: 0.01,
      unit: 'G',
      defaultValue: 0,
    });
    expect(HMC5883L_Z_KNOB).toMatchObject({
      id: 'z',
      label: 'Z field',
      min: -2,
      max: 2,
      step: 0.01,
      unit: 'G',
      defaultValue: 0.5,
    });
  });
});
