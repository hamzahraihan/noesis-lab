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

  it('accepts every data byte, because the chip has no register pointer', () => {
    const expander = new Pcf8574();
    expander.receive(0x00, true);
    expander.receive(0b1111_0000, false);
    expander.receive(0x01, true);
    // The PCF8574 has no register pointer: every byte after the address
    // is treated as output register data. There is no "input register"
    // to write to, so the write is accepted and updates the latch.
    expect(expander.receive(0b0000_1111, false)).toBe(true);
    // The ports now reflect the last byte written.
    expect(expander.output(4)).toBe(false);
    expect(expander.output(0)).toBe(true);
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
