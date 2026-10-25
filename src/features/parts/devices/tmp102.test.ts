import { describe, expect, it } from 'vitest';
import { TMP102_ADDRESS, TMP102_TEMPERATURE_KNOB, Tmp102 } from './tmp102';
import { tmp102Definition } from './sensors';

/** Points the chip at a register. */
function pointAt(device: Tmp102, register: number): void {
  device.receive(register, true);
}

/** Writes a register's bytes, most significant first. */
function writeRegister(device: Tmp102, register: number, ...bytes: readonly number[]): void {
  pointAt(device, register);
  bytes.forEach((byte) => device.receive(byte, false));
}

describe('TMP102 temperature sensor', () => {
  it('answers at 0x48', () => {
    expect(new Tmp102().address).toBe(TMP102_ADDRESS);
    expect(TMP102_ADDRESS).toBe(0x48);
  });

  it('reports the temperature left-justified in a signed twelve-bit word', () => {
    const device = new Tmp102();
    let celsius = 21;
    device.setTemperatureSource(() => celsius);

    pointAt(device, 0x00);
    // 21 C is 336 counts at 0.0625 C, left-justified across two bytes.
    expect(device.read(2)).toEqual([0x15, 0x00]);

    celsius = 21.5;
    pointAt(device, 0x00);
    expect(device.read(2)).toEqual([0x15, 0x80]);

    celsius = -0.5;
    pointAt(device, 0x00);
    expect(device.read(2)).toEqual([0xff, 0x80]);
  });

  it('starts with the datasheet configuration and trip points', () => {
    const device = new Tmp102();
    expect(device.read(2), 'temperature at 21 C').toEqual([0x15, 0x00]);
    pointAt(device, 0x01);
    expect(device.read(2), 'configuration').toEqual([0x60, 0xa0]);
    pointAt(device, 0x02);
    expect(device.read(2), 'T_LOW').toEqual([0x4b, 0x00]);
    pointAt(device, 0x03);
    expect(device.read(2), 'T_HIGH').toEqual([0x50, 0x00]);
  });

  it('writes the configuration and both trip points back', () => {
    const device = new Tmp102();
    writeRegister(device, 0x01, 0x61, 0xa1);
    pointAt(device, 0x01);
    expect(device.read(2)).toEqual([0x61, 0xa1]);

    writeRegister(device, 0x02, 0x4a, 0x00);
    pointAt(device, 0x02);
    expect(device.read(2)).toEqual([0x4a, 0x00]);

    writeRegister(device, 0x03, 0x51, 0x00);
    pointAt(device, 0x03);
    expect(device.read(2)).toEqual([0x51, 0x00]);
  });

  it('leaves the pointer where the sketch put it across reads', () => {
    const device = new Tmp102();
    pointAt(device, 0x01);
    expect(device.read(2)).toEqual([0x60, 0xa0]);
    // Reading a register does not walk the pointer to the next one: the chip
    // holds the register the sketch named until another write names one.
    expect(device.read(2)).toEqual([0x60, 0xa0]);
  });

  it('repeats the last byte for a read longer than its two-byte frame', () => {
    const device = new Tmp102();
    device.setTemperatureSource(() => 21);
    pointAt(device, 0x00);
    expect(device.read(4)).toEqual([0x15, 0x00, 0x00, 0x00]);
  });

  it('exposes the temperature as a knob in Celsius', () => {
    expect(TMP102_TEMPERATURE_KNOB).toMatchObject({
      id: 'temperature',
      unit: '°C',
      min: -40,
      max: 125,
      step: 0.0625,
    });
  });
});

describe('the TMP102 module', () => {
  const definition = tmp102Definition();

  it('is a four-pin I2C sensor', () => {
    expect(definition.component).toEqual({ kind: 'i2c-sensor', device: 'tmp102' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['GND', 'VCC', 'SDA', 'SCL']);
  });

  it('carries its temperature control', () => {
    expect(definition.knobs).toContainEqual(TMP102_TEMPERATURE_KNOB);
  });
});
