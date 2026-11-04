import { describe, expect, it } from 'vitest';
import { mcp4725Definition, Mcp4725, MCP4725_MAX_CODE } from './mcp4725';

describe('the MCP4725', () => {
  it('takes the code from a fast write', () => {
    const converter = new Mcp4725();
    // The top byte holds the command bits and the four high bits of the
    // code; the low byte holds the other eight.
    converter.receive(0x01, true);
    converter.receive(0x00, false);
    expect(converter.output(5)).toBeCloseTo((5 * 256) / MCP4725_MAX_CODE, 6);
  });

  it('takes the code from a write that starts with a command byte', () => {
    const converter = new Mcp4725();
    converter.receive(0x40, true);
    converter.receive(0x80, false);
    converter.receive(0x00, false);
    expect(converter.output(5)).toBeCloseTo((5 * 2048) / MCP4725_MAX_CODE, 6);
  });

  it('holds the voltage its code asks for, between the ground and the supply', () => {
    const converter = new Mcp4725();
    converter.receive(0x0f, true);
    converter.receive(0xff, false);
    expect(converter.output(5)).toBeCloseTo(5, 6);

    converter.receive(0x00, true);
    converter.receive(0x00, false);
    expect(converter.output(5)).toBe(0);
  });

  it('answers on the address the module is strapped to', () => {
    expect(new Mcp4725().address).toBe(0x60);
  });

  it('reads back the datasheet 3-byte DAC frame (status + 2 data bytes)', () => {
    const converter = new Mcp4725();
    converter.receive(0x40, true);
    converter.receive(0xa0, false);
    converter.receive(0x00, false);
    // Code 0xA00: frame = [code>>4 = 0xA0, (code<<4 | 0x01) = 0x01, 0x00]
    expect(converter.read(3)).toEqual([0xa0, 0x01, 0x00]);
  });
});

describe('the MCP4725 module', () => {
  it('is a converter with the two bus wires and an output', () => {
    const definition = mcp4725Definition();
    expect(definition.component).toEqual({ kind: 'dac' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['VCC', 'GND', 'SDA', 'SCL', 'AOUT']);
  });
});
