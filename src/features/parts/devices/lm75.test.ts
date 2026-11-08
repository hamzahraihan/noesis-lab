import { describe, expect, it } from 'vitest';
import { LM75_ADDRESS, LM75_TEMPERATURE_KNOB, Lm75 } from './lm75';
import { lm75Definition } from './sensors';

/** Points the chip at a register. */
function pointAt(device: Lm75, register: number): void {
  device.receive(register, true);
}

/** Writes a register's bytes, most significant first. */
function writeRegister(device: Lm75, register: number, ...bytes: readonly number[]): void {
  pointAt(device, register);
  bytes.forEach((byte) => device.receive(byte, false));
}

describe('LM75 temperature sensor', () => {
  it('answers at 0x48', () => {
    expect(new Lm75().address).toBe(LM75_ADDRESS);
    expect(LM75_ADDRESS).toBe(0x48);
  });

  it('reports the temperature left-justified in a signed eleven-bit word', () => {
    const device = new Lm75();
    let celsius = 21;
    device.setTemperatureSource(() => celsius);

    pointAt(device, 0x00);
    // 21 C is 168 counts at 0.125 C, left-justified across two bytes.
    expect(device.read(2)).toEqual([0x15, 0x00]);

    celsius = 21.125;
    pointAt(device, 0x00);
    expect(device.read(2)).toEqual([0x15, 0x20]);

    celsius = -0.5;
    pointAt(device, 0x00);
    expect(device.read(2)).toEqual([0xff, 0x80]);
  });

  it('starts with the datasheet configuration and trip points', () => {
    const device = new Lm75();
    expect(device.read(2), 'temperature at 21 C').toEqual([0x15, 0x00]);
    pointAt(device, 0x01);
    expect(device.read(2), 'configuration').toEqual([0x00, 0x00]);
    pointAt(device, 0x02);
    expect(device.read(2), 'T_HYST').toEqual([0x4b, 0x00]);
    pointAt(device, 0x03);
    expect(device.read(2), 'T_OS').toEqual([0x50, 0x00]);
  });

  it('writes the configuration and both trip points back', () => {
    const device = new Lm75();
    writeRegister(device, 0x01, 0x00, 0x01);
    pointAt(device, 0x01);
    expect(device.read(2)).toEqual([0x00, 0x01]);

    writeRegister(device, 0x02, 0x4a, 0x00);
    pointAt(device, 0x02);
    expect(device.read(2)).toEqual([0x4a, 0x00]);

    writeRegister(device, 0x03, 0x51, 0x00);
    pointAt(device, 0x03);
    expect(device.read(2)).toEqual([0x51, 0x00]);
  });

  it('leaves the pointer where the sketch put it across reads', () => {
    const device = new Lm75();
    pointAt(device, 0x01);
    expect(device.read(2)).toEqual([0x00, 0x00]);
    expect(device.read(2)).toEqual([0x00, 0x00]);
  });

  it('repeats the last byte for a read longer than its two-byte frame', () => {
    const device = new Lm75();
    device.setTemperatureSource(() => 21);
    pointAt(device, 0x00);
    expect(device.read(4)).toEqual([0x15, 0x00, 0x00, 0x00]);
  });

  it('exposes the temperature as a knob in Celsius', () => {
    expect(LM75_TEMPERATURE_KNOB).toMatchObject({
      id: 'temperature',
      unit: '°C',
      min: -55,
      max: 125,
      step: 0.125,
    });
  });
});

describe('the LM75 module', () => {
  const definition = lm75Definition();

  it('is a four-pin I2C sensor', () => {
    expect(definition.component).toEqual({ kind: 'i2c-sensor', device: 'lm75' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['GND', 'VCC', 'SDA', 'SCL']);
  });

  it('carries its temperature control', () => {
    expect(definition.knobs).toContainEqual(LM75_TEMPERATURE_KNOB);
  });
});
