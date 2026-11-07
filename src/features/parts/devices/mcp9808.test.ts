import { describe, expect, it } from 'vitest';
import {
  MCP9808_ADDRESS,
  MCP9808_TEMPERATURE_KNOB,
  Mcp9808,
} from './mcp9808';
import { mcp9808Definition } from './sensors';

/** Points the chip at a register. */
function pointAt(device: Mcp9808, register: number): void {
  device.receive(register, true);
}

/** Writes a register's bytes, most significant first. */
function writeRegister(device: Mcp9808, register: number, ...bytes: readonly number[]): void {
  pointAt(device, register);
  bytes.forEach((byte) => device.receive(byte, false));
}

describe('MCP9808 temperature sensor', () => {
  it('answers at 0x18', () => {
    expect(new Mcp9808().address).toBe(MCP9808_ADDRESS);
    expect(MCP9808_ADDRESS).toBe(0x18);
  });

  it('reports the temperature left-justified in a thirteen-bit word', () => {
    const device = new Mcp9808();
    let celsius = 25;
    device.setTemperatureSource(() => celsius);

    pointAt(device, 0x05);
    // 25 C is 400 counts at 0.0625 C, left-justified across the top thirteen bits.
    expect(device.read(2)).toEqual([0x0c, 0x80]);

    celsius = 25.5;
    pointAt(device, 0x05);
    expect(device.read(2)).toEqual([0x0c, 0xc0]);

    celsius = -10;
    pointAt(device, 0x05);
    expect(device.read(2)).toEqual([0xfb, 0x00]);
  });

  it('starts with the reset configuration', () => {
    const device = new Mcp9808();
    pointAt(device, 0x01);
    expect(device.read(2), 'configuration').toEqual([0x00, 0x00]);
  });

  it('writes the configuration back', () => {
    const device = new Mcp9808();
    writeRegister(device, 0x01, 0x00, 0x01);
    pointAt(device, 0x01);
    expect(device.read(2)).toEqual([0x00, 0x01]);
  });

  it('leaves the pointer where the sketch put it across reads', () => {
    const device = new Mcp9808();
    pointAt(device, 0x01);
    expect(device.read(2)).toEqual([0x00, 0x00]);
    // Reading a register does not walk the pointer to the next one: the chip
    // holds the register the sketch named until another write names one.
    expect(device.read(2)).toEqual([0x00, 0x00]);
  });

  it('repeats the last byte for a read longer than its two-byte frame', () => {
    const device = new Mcp9808();
    device.setTemperatureSource(() => 25);
    pointAt(device, 0x05);
    expect(device.read(4)).toEqual([0x0c, 0x80, 0x80, 0x80]);
  });

  it('exposes the temperature as a knob in Celsius', () => {
    expect(MCP9808_TEMPERATURE_KNOB).toMatchObject({
      id: 'temperature',
      unit: '°C',
      min: -55,
      max: 125,
      step: 0.0625,
    });
  });
});

describe('the MCP9808 module', () => {
  const definition = mcp9808Definition();

  it('is a four-pin I2C sensor', () => {
    expect(definition.component).toEqual({ kind: 'i2c-sensor', device: 'mcp9808' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['GND', 'VCC', 'SDA', 'SCL']);
  });

  it('carries its temperature control', () => {
    expect(definition.knobs).toContainEqual(MCP9808_TEMPERATURE_KNOB);
  });
});
