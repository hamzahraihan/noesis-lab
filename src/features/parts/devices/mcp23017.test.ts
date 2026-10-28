import { describe, expect, it } from 'vitest';
import { Mcp23017, mcp23017Definition } from './mcp23017';

/** The bank-0 registers the tests name, as the datasheet numbers them. */
const IODIR_A = 0x00;
const IODIR_B = 0x01;
const IPOL_A = 0x02;
const GPINTEN_A = 0x04;
const GPINTEN_B = 0x05;
const DEFVAL_A = 0x06;
const INTCON_A = 0x08;
const IOCON_A = 0x0a;
const GPPU_A = 0x0c;
const GPPU_B = 0x0d;
const INTF_A = 0x0e;
const INTF_B = 0x0f;
const INTCAP_A = 0x10;
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

/** Sixteen port levels, the ones named in `high` sitting at the supply. */
function levels(...high: number[]): boolean[] {
  return Array.from({ length: 16 }, (_, index) => high.includes(index));
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

  it('does not watch a pin until its interrupt bit is set', () => {
    const expander = new Mcp23017();
    expander.updateInputs(levels());
    expander.updateInputs(levels(0));
    expect(read(expander, INTF_A)).toBe(0x00);
  });

  it('raises a flag on a change and captures the port', () => {
    const expander = new Mcp23017();
    write(expander, GPINTEN_A, 0x01);
    expander.updateInputs(levels());
    expander.updateInputs(levels(0));
    expect(read(expander, INTF_A)).toBe(0x01);
    // The capture is the byte the port held when the edge arrived.
    expect(read(expander, INTCAP_A)).toBe(0x01);
  });

  it('follows DEFVAL rather than the edge when INTCON is set', () => {
    const expander = new Mcp23017();
    write(expander, GPINTEN_A, 0x03);
    write(expander, INTCON_A, 0x03);
    // PA0 is wanted high and PA1 wanted low.
    write(expander, DEFVAL_A, 0x01);
    expander.updateInputs(levels());
    expect(read(expander, INTF_A), 'PA0 differs from its default').toBe(0x01);
    expander.updateInputs(levels(0, 1));
    // Reading the flags does not clear them, so the two hits accumulate.
    expect(read(expander, INTF_A), 'now PA1 differs from its default too').toBe(0x03);
  });

  it('takes the flag down when the port is read', () => {
    const expander = new Mcp23017();
    write(expander, GPINTEN_A, 0x01);
    expander.updateInputs(levels());
    expander.updateInputs(levels(0));
    // Active low by default, so the asserted pin is the low one.
    expect(expander.interruptLevel(0)).toBe(false);
    read(expander, GPIO_A);
    expect(expander.interruptLevel(0)).toBe(true);
    expect(read(expander, INTF_A)).toBe(0x00);
  });

  it('leaves the interrupt up when the flags register is read', () => {
    const expander = new Mcp23017();
    write(expander, GPINTEN_A, 0x01);
    expander.updateInputs(levels());
    expander.updateInputs(levels(0));
    // The datasheet keeps the interrupt active until GPIO or INTCAP is read;
    // INTF is a report of which pin fired, not the way to acknowledge it.
    expect(read(expander, INTF_A)).toBe(0x01);
    expect(expander.interruptLevel(0), 'the flag read did not clear it').toBe(false);
    expect(read(expander, INTF_A), 'and the flag is still there').toBe(0x01);
    read(expander, GPIO_A);
    expect(expander.interruptLevel(0), 'the port read did').toBe(true);
  });

  it('follows INTPOL for the active level', () => {
    const expander = new Mcp23017();
    write(expander, GPINTEN_A, 0x01);
    write(expander, IOCON_A, 0x02);
    expander.updateInputs(levels());
    expect(expander.interruptLevel(0), 'idle drives low').toBe(false);
    expander.updateInputs(levels(0));
    expect(expander.interruptLevel(0), 'asserted drives high').toBe(true);
  });

  it('releases an open-drain output instead of driving it high', () => {
    const expander = new Mcp23017();
    write(expander, GPINTEN_B, 0x01);
    write(expander, IOCON_A, 0x04);
    expander.updateInputs(levels());
    expect(expander.interruptLevel(1), 'released, so nothing drives the pin').toBeNull();
    expander.updateInputs(levels(8));
    expect(expander.interruptLevel(1), 'asserted pulls low').toBe(false);
  });

  it('ties the two interrupt pins together when mirrored', () => {
    const expander = new Mcp23017();
    write(expander, GPINTEN_B, 0x01);
    write(expander, IOCON_A, 0x40);
    expander.updateInputs(levels());
    expander.updateInputs(levels(8));
    // MIRROR connects the pins internally, so both carry port B's flag and
    // either one can be wired to the host.
    expect(expander.interruptLevel(1), 'INTB carries it too').toBe(false);
    expect(expander.interruptLevel(0), 'INTA carries port B').toBe(false);
    expect(read(expander, INTF_B), 'port B owns the flag both pins carry').toBe(0x01);
  });

  it('does not flag a pin the chip is driving', () => {
    const expander = new Mcp23017();
    write(expander, IODIR_A, 0b0000_1111); // PA4..PA7 driven
    write(expander, GPIO_A, 0b1111_0000); // ... high
    write(expander, GPINTEN_A, 0b1111_0000); // watch the driven pins
    write(expander, INTCON_A, 0b1111_0000); // level mode
    write(expander, DEFVAL_A, 0b1111_0000); // ... expecting them high
    expander.updateInputs(levels());
    // An output has no interrupt, however the compare registers are set.
    expect(read(expander, INTF_A)).toBe(0x00);
  });

  it('captures a driven pin from its latch', () => {
    const expander = new Mcp23017();
    write(expander, IODIR_A, 0b0000_1111);
    write(expander, GPIO_A, 0b1111_0000);
    write(expander, GPINTEN_A, 0x01); // PA0, an input
    expander.updateInputs(levels());
    expander.updateInputs(levels(0));
    // The capture is the port as a read would show it: the driven half is the
    // latch, the listening half is the wire.
    expect(read(expander, INTCAP_A)).toBe(0b1111_0001);
  });

  it('refuses a write to the flag and capture registers', () => {
    const expander = new Mcp23017();
    write(expander, GPINTEN_A, 0x01);
    expander.updateInputs(levels());
    expander.updateInputs(levels(0));
    write(expander, INTF_A, 0x00);
    write(expander, INTCAP_A, 0x42);
    expect(read(expander, INTF_A)).toBe(0x01);
    expect(read(expander, INTCAP_A)).toBe(0x01);
  });

  it('walks the registers in one burst, the way the chip does', () => {
    const expander = new Mcp23017();
    expander.receive(IODIR_A, true);
    expander.receive(0x00, false);
    expander.receive(0x0f, false);
    expander.receive(IODIR_A, true);
    expect(expander.read(4)).toEqual([0x00, 0x0f, 0x00, 0x00]);
  });

  it('reads a pin it is not driving from the wiring, not the latch', () => {
    const expander = new Mcp23017();
    write(expander, OLAT_A, 0xff);
    // Port A is still all inputs, so the latch is not what the pins report.
    expander.setPinLevels((index) => index === 2 || index === 5);
    expect(read(expander, GPIO_A)).toBe(0b0010_0100);
    // The latch still holds the byte, for whichever port turns output next.
    expect(read(expander, OLAT_A)).toBe(0xff);
    expect(expander.output(0)).toBe(true);
  });

  it('reads an input pin low when nothing establishes its level', () => {
    const expander = new Mcp23017();
    write(expander, OLAT_A, 0x0f);
    // A port with no pull-up and no wiring has no level to report.
    expander.setPinLevels(() => false);
    expect(read(expander, GPIO_A)).toBe(0x00);
  });

  it('mixes latch and wiring in one byte, by direction', () => {
    const expander = new Mcp23017();
    write(expander, IODIR_A, 0b1111_0000);
    write(expander, GPIO_A, 0b0000_0101);
    const asked: number[] = [];
    expander.setPinLevels((index) => {
      asked.push(index);
      return index === 5 || index === 7;
    });
    // PA0 and PA2 are outputs, so they report the latch; PA5 and PA7 are
    // inputs and report the wires.
    expect(read(expander, GPIO_A)).toBe(0b1010_0101);
    expect(asked, 'only the input pins were sampled').toEqual([4, 5, 6, 7]);
  });

  it('turns a pull-up on per port from the pull-up registers', () => {
    const expander = new Mcp23017();
    for (let index = 0; index < 16; index++) {
      expect(expander.pullUp(index), `port ${index} powers up without a pull-up`).toBe(false);
    }
    write(expander, GPPU_A, 0b0000_1000);
    write(expander, GPPU_B, 0b1000_0000);
    expect(expander.pullUp(3)).toBe(true);
    expect(expander.pullUp(2)).toBe(false);
    expect(expander.pullUp(15)).toBe(true);
    expect(expander.pullUp(14)).toBe(false);
  });

  it('inverts a wiring read through the polarity register', () => {
    const expander = new Mcp23017();
    expander.setPinLevels((index) => index === 1);
    write(expander, IPOL_A, 0xff);
    expect(read(expander, GPIO_A)).toBe(0b1111_1101);
  });
});

describe('the MCP23017 module', () => {
  it('is an expander with sixteen ports, the bus and two interrupt outputs', () => {
    const definition = mcp23017Definition();
    expect(definition.component).toEqual({ kind: 'mcp23017' });
    expect(definition.pins.map((pin) => pin.id)).toEqual([
      'VCC',
      'GND',
      'SDA',
      'SCL',
      'INTA',
      'INTB',
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
