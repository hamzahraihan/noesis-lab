import { describe, expect, it } from 'vitest';
import { Mcp23017, mcp23017Definition } from './mcp23017';

/** The bank-0 registers the tests name, as the datasheet numbers them. */
const IODIR_A = 0x00;
const IODIR_B = 0x01;
const IPOL_A = 0x02;
const GPIO_A = 0x12;
const OLAT_A = 0x14;
const OLAT_B = 0x15;

/** Writes one register and then its value, the way a sketch transaction does. */
function write(expander: Mcp23017, register: number, value: number): void {
  expander.receive(register, true);
  expander.receive(value, false);
}

/** Points at a register and reads one byte back. */
function read(expander: Mcp23017, register: number): number {
  expander.receive(register, true);
  return expander.read(1)[0]!;
}

describe('the MCP23017', () => {
  it('answers on the address the module is strapped to', () => {
    expect(new Mcp23017().address).toBe(0x20);
  });

  it('powers up with every port an input and every latch low', () => {
    const expander = new Mcp23017();
    expect(read(expander, IODIR_A)).toBe(0xff);
    expect(read(expander, IODIR_B)).toBe(0xff);
    expect(read(expander, OLAT_A)).toBe(0x00);
    expect(read(expander, OLAT_B)).toBe(0x00);
    for (let index = 0; index < 16; index++) {
      expect(expander.isOutput(index), `port ${index} is an input`).toBe(false);
    }
  });

  it('makes a port an output when its direction bit is cleared', () => {
    const expander = new Mcp23017();
    write(expander, IODIR_A, 0b1111_0000);
    expect(expander.isOutput(0)).toBe(true);
    expect(expander.isOutput(3)).toBe(true);
    expect(expander.isOutput(4)).toBe(false);
    expect(expander.isOutput(7)).toBe(false);
    // Port B is a different register and is still all inputs.
    expect(expander.isOutput(8)).toBe(false);
  });

  it('drives the latches from the bytes the sketch wrote', () => {
    const expander = new Mcp23017();
    write(expander, IODIR_A, 0x00);
    write(expander, IODIR_B, 0x00);
    write(expander, GPIO_A, 0b1010_1010);
    write(expander, OLAT_B, 0b0101_0101);
    expect(expander.output(1)).toBe(true);
    expect(expander.output(3)).toBe(true);
    expect(expander.output(0)).toBe(false);
    expect(expander.output(8)).toBe(true);
    expect(expander.output(9)).toBe(false);
  });

  it('keeps the output latches when the pins are written through GPIO', () => {
    const expander = new Mcp23017();
    write(expander, IODIR_A, 0x00);
    write(expander, GPIO_A, 0x5a);
    expect(read(expander, OLAT_A)).toBe(0x5a);
    expect(read(expander, GPIO_A)).toBe(0x5a);
  });

  it('reads a port back through the polarity register', () => {
    const expander = new Mcp23017();
    write(expander, IODIR_A, 0x00);
    write(expander, GPIO_A, 0b0000_1111);
    write(expander, IPOL_A, 0xff);
    expect(read(expander, GPIO_A)).toBe(0b1111_0000);
    // The latch itself is not inverted.
    expect(read(expander, OLAT_A)).toBe(0b0000_1111);
  });

  it('walks the registers in one burst, the way the chip does', () => {
    const expander = new Mcp23017();
    expander.receive(IODIR_A, true);
    expander.receive(0x00, false);
    expander.receive(0x0f, false);
    expander.receive(IODIR_A, true);
    expect(expander.read(4)).toEqual([0x00, 0x0f, 0x00, 0x00]);
  });

  it('reads input pins as the latch too, which is what the bench models', () => {
    const expander = new Mcp23017();
    write(expander, OLAT_A, 0x0f);
    // Port A is still all inputs: the bench has no wiring to report, so the
    // latch is the only level it can answer with.
    expect(read(expander, GPIO_A)).toBe(0x0f);
    expect(expander.output(0)).toBe(true);
  });
});

describe('the MCP23017 module', () => {
  it('is an expander with sixteen ports and four bus wires', () => {
    const definition = mcp23017Definition();
    expect(definition.component).toEqual({ kind: 'mcp23017' });
    expect(definition.pins.map((pin) => pin.id)).toEqual([
      'VCC',
      'GND',
      'SDA',
      'SCL',
      'PA0',
      'PA1',
      'PA2',
      'PA3',
      'PA4',
      'PA5',
      'PA6',
      'PA7',
      'PB0',
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PB5',
      'PB6',
      'PB7',
    ]);
  });
});
