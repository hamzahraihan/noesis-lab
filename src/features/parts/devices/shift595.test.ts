import { describe, expect, it } from 'vitest';
import { Shift595, shift595Definition } from './shift595';

describe('the 74HC595', () => {
  it('shifts a byte in and latches it to the outputs', () => {
    const register = new Shift595();
    // The chip's shift register moves toward Q7, so the first bit to arrive
    // ends up there and the last on Q0.
    register.receive(0b0000_0001, true, true);

    // Nothing reaches the outputs until the latch says so.
    expect(register.output(7)).toBe(false);
    expect(register.output(0)).toBe(false);

    register.setLatchLevel(true);
    expect(register.output(0)).toBe(true);
    expect(register.output(7)).toBe(false);
  });

  it('takes eight bits, and the first of them lands on Q7', () => {
    const register = new Shift595();
    // The bit that arrives first is the one that ends up furthest along.
    register.receive(0b1000_0000, true, true);
    register.setLatchLevel(true);
    expect(register.output(7)).toBe(true);
    expect(register.output(0)).toBe(false);
  });

  it('holds the last byte until the next latch', () => {
    const register = new Shift595();
    register.receive(0b1111_1111, true, true);
    register.setLatchLevel(true);
    expect(register.output(0)).toBe(true);
    expect(register.output(7)).toBe(true);

    // A new byte shifts in behind the latch: the outputs still hold the
    // last one until the latch rises again.
    register.receive(0b0000_0000, true, true);
    expect(register.output(0)).toBe(true);
    register.setLatchLevel(true);
    expect(register.output(0)).toBe(false);
  });

  it('floats its outputs while the enable line is pulled down', () => {
    const register = new Shift595();
    register.receive(0b1111_1111, true, true);
    register.setLatchLevel(true);
    expect(register.output(0)).toBe(true);
    // The enable line is active low.
    register.setEnableLevel(true);
    expect(register.output(0)).toBe(false);
    register.setEnableLevel(false);
    expect(register.output(0)).toBe(true);
  });
});

describe('the 74HC595 module', () => {
  it('carries the chip\u2019s own pins on a two-row header', () => {
    const definition = shift595Definition();
    expect(definition.pins.map((pin) => pin.id)).toEqual([
      'OE',
      'SRCLK',
      'SER',
      'RCLK',
      'Q0',
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'Q5',
      'Q6',
      'Q7',
      'VCC',
      'GND',
    ]);
    // The clock and the data in are the bus's wires; the latch is the
    // sketch's own pin, because on the chip they are separate.
    expect(definition.component).toEqual({
      kind: 'shift-register',
      spi: { clock: 'SRCLK', dataIn: 'SER' },
      latch: 'RCLK',
      enable: 'OE',
    });
  });
});
