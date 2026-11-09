import { describe, expect, it } from 'vitest';
import { ADXL345_X_KNOB, ADXL345_Y_KNOB, ADXL345_Z_KNOB, Adxl345 } from './adxl345';

describe('ADXL345 digital accelerometer', () => {
  it('reports X acceleration as a raw word', () => {
    const sensor = new Adxl345();
    sensor.setAccelerationSource(() => ({ x: 1, y: 0, z: 0 }));
    sensor.receive(0x32, true);
    const bytes = sensor.read(2);
    const raw = bytes[0]! | (bytes[1]! << 8);
    const g = (raw * 3.9) / 1000;
    expect(g).toBeCloseTo(1, 1);
  });

  it('reports device ID 0xE5', () => {
    const sensor = new Adxl345();
    sensor.receive(0x00, true);
    const bytes = sensor.read(1);
    expect(bytes[0]).toBe(0xe5);
  });

  it('knobs carry the sensor range', () => {
    expect(ADXL345_X_KNOB).toMatchObject({
      id: 'x',
      label: 'X acceleration',
      min: -2,
      max: 2,
      step: 0.01,
      unit: 'g',
      defaultValue: 0,
    });
    expect(ADXL345_Y_KNOB).toMatchObject({
      id: 'y',
      label: 'Y acceleration',
      min: -2,
      max: 2,
      step: 0.01,
      unit: 'g',
      defaultValue: 0,
    });
    expect(ADXL345_Z_KNOB).toMatchObject({
      id: 'z',
      label: 'Z acceleration',
      min: -2,
      max: 2,
      step: 0.01,
      unit: 'g',
      defaultValue: 1,
    });
  });

});
