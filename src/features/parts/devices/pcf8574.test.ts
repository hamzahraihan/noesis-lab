import { describe, expect, it } from 'vitest';
import { pcf8574Definition, Pcf8574 } from './pcf8574';

describe('the PCF8574', () => {
  it('starts with its ports high, the way the chip powers up', () => {
    const expander = new Pcf8574();
    expect(Array.from({ length: 8 }, (_, index) => expander.output(index))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('drives the ports from the byte the sketch wrote', () => {
    const expander = new Pcf8574();
    expander.receive(0x00, true);
    expander.receive(0b0101_0000, false);
    expect(expander.output(4)).toBe(true);
    expect(expander.output(6)).toBe(true);
    expect(expander.output(0)).toBe(false);
  });

  it('reads back what was written', () => {
    const expander = new Pcf8574();
    expander.receive(0x00, true);
    expander.receive(0b1010_1010, false);
    expect(expander.read(4)).toEqual([0b1010_1010, 0b1010_1010, 0b1010_1010, 0b1010_1010]);
  });

  it('refuses a write to the input register, the way the chip does', () => {
    const expander = new Pcf8574();
    expander.receive(0x00, true);
    expander.receive(0b1111_0000, false);
    expander.receive(0x01, true);
    expect(expander.receive(0b0000_1111, false)).toBe(false);
    // The refused write left the ports where they were.
    expect(expander.output(4)).toBe(true);
    expect(expander.output(0)).toBe(false);
  });

  it('answers on the address the module is strapped to', () => {
    expect(new Pcf8574().address).toBe(0x20);
  });
});

describe('the PCF8574 module', () => {
  it('is an expander with eight ports and four bus wires', () => {
    const definition = pcf8574Definition();
    expect(definition.component).toEqual({ kind: 'i2c-expander' });
    expect(definition.pins.map((pin) => pin.id)).toEqual([
      'VCC',
      'GND',
      'SDA',
      'SCL',
      'P0',
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
      'P7',
    ]);
  });
});
