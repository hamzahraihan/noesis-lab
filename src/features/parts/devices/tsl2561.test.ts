import { describe, expect, it } from 'vitest';
import { TSL2561_LIGHT_KNOB, Tsl2561 } from './tsl2561';

describe('TSL2561 light sensor', () => {
  it('reports channel 0 and channel 1 counts', () => {
    const sensor = new Tsl2561();
    sensor.setLightSource(() => 250);
    // Power on
    sensor.receive(0x00 | 0x80, true);
    sensor.receive(0x03, false);
    // Read data registers
    sensor.receive(0x0c | 0x80, true);
    const bytes = sensor.read(4);
    const ch0 = bytes[0]! | (bytes[1]! << 8);
    const ch1 = bytes[2]! | (bytes[3]! << 8);
    expect(ch0).toBeGreaterThan(0);
    expect(ch1).toBeGreaterThan(0);
    expect(ch1).toBeLessThan(ch0);
  });

  it('knobs carry the sensor range', () => {
    expect(TSL2561_LIGHT_KNOB).toMatchObject({
      id: 'light',
      label: 'Light',
      min: 0,
      max: 10_000,
      step: 1,
      unit: 'lx',
      defaultValue: 250,
    });
  });
});
