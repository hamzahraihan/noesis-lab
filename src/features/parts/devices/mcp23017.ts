/**
 * MCP23017: sixteen pins in two wires.
 *
 * The PCF8574 answers the board's pin shortage with one byte. This chip
 * answers it with two ports and a direction register: every pin can be an
 * input or an output, and the sketch says which by clearing a bit in IODIR.
 * The power-up state is all inputs, so a sketch that writes a latch without
 * setting the direction changes nothing on the pins -- which is the mistake
 * the part exists to teach.
 *
 * The bench models bank 0, the register map the chip powers up in: IODIRA and
 * IODIRB at 0x00 and 0x01, the output latches at 0x14 and 0x15, and the GPIO
 * registers at 0x12 and 0x13. Interrupts and the input-polarity wiring are
 * stored but not acted on; a port reads back the latch, because on a bench
 * with nothing wired to the inputs the latch is the only level there is.
 */

import type { PartDefinition } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers on, with the address straps open. */
export const MCP23017_ADDRESS = 0x20;

/** How many ports the chip has: two banks of eight. */
export const MCP23017_PORTS = 16;

/**
 * The output stage, in ohms.
 *
 * The chip's outputs are push-pull, and the bench gives them the same output
 * impedance it gives the other expander so a driven pin reads as driven.
 */
export const MCP23017_OUTPUT_OHMS = 1000;

/** The port holes, in the order the register banks number them. */
export const MCP23017_PORT_PINS = [
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
] as const;

/** Bank-0 registers, as the datasheet numbers them. */
const IODIR_A = 0x00;
const IODIR_B = 0x01;
const IPOL_A = 0x02;
const IPOL_B = 0x03;
const GPIO_A = 0x12;
const GPIO_B = 0x13;
const OLAT_A = 0x14;
const OLAT_B = 0x15;
/** One past the last bank-0 register: a burst wraps back to IODIRA here. */
const REGISTER_COUNT = 0x16;

export class Mcp23017 implements I2cDevice {
  readonly address = MCP23017_ADDRESS;
  onBus = false;

  /**
   * Every bank-0 register, in datasheet order. Power-up has the direction
   * registers set to all ones, so every port starts as an input.
   */
  private readonly registers = new Uint8Array(REGISTER_COUNT);
  /** Which register the next byte goes to or comes from. */
  private pointer = IODIR_A;

  constructor() {
    this.registers[IODIR_A] = 0xff;
    this.registers[IODIR_B] = 0xff;
  }

  /**
   * One byte of a transaction.
   *
   * The first byte names the register; every byte after it lands in that
   * register and moves the pointer on, so a sketch can write both directions
   * or both latches in one burst. Writes past the last register wrap to the
   * first, which is the chip's sequential mode.
   */
  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte % REGISTER_COUNT;
      return true;
    }
    this.writeRegister(this.pointer, byte & 0xff);
    this.pointer = (this.pointer + 1) % REGISTER_COUNT;
    return true;
  }

  /** Reads the register file from the current pointer, wrapping like a burst. */
  read(count: number): readonly number[] {
    const out: number[] = [];
    for (let index = 0; index < Math.max(0, count); index++) {
      out.push(this.readRegister(this.pointer));
      this.pointer = (this.pointer + 1) % REGISTER_COUNT;
    }
    return out;
  }

  /** The level the latch is holding for a port, whether or not it is an output. */
  output(index: number): boolean {
    return (this.latch(index) >> (index % 8) & 1) === 1;
  }

  /** Whether a port is configured to drive its pin rather than listen to it. */
  isOutput(index: number): boolean {
    const directions = index < 8 ? this.registers[IODIR_A]! : this.registers[IODIR_B]!;
    return (directions >> (index % 8) & 1) === 0;
  }

  private writeRegister(register: number, value: number): void {
    if (register === GPIO_A || register === OLAT_A) {
      this.registers[OLAT_A] = value;
      return;
    }
    if (register === GPIO_B || register === OLAT_B) {
      this.registers[OLAT_B] = value;
      return;
    }
    this.registers[register] = value;
  }

  private readRegister(register: number): number {
    if (register === GPIO_A) return this.latch(0) ^ this.registers[IPOL_A]!;
    if (register === GPIO_B) return this.latch(8) ^ this.registers[IPOL_B]!;
    if (register === OLAT_A) return this.latch(0);
    if (register === OLAT_B) return this.latch(8);
    return this.registers[register] ?? 0;
  }

  private latch(index: number): number {
    return index < 8 ? this.registers[OLAT_A]! : this.registers[OLAT_B]!;
  }
}

/**
 * The module as it is sold: a small breakout with the chip on it, the four
 * bus wires along the top and sixteen ports in two rows below.
 */
export function mcp23017Definition(): PartDefinition {
  const pins = [
    { id: 'VCC', label: 'VCC', x: 2.54, y: 4.0, net: 'VCC' },
    { id: 'GND', label: 'GND', x: 5.08, y: 4.0, net: 'GND' },
    { id: 'SDA', label: 'SDA', x: 7.62, y: 4.0 },
    { id: 'SCL', label: 'SCL', x: 10.16, y: 4.0 },
  ];
  for (let index = 0; index < MCP23017_PORTS; index++) {
    const row = Math.floor(index / 8);
    pins.push({
      id: MCP23017_PORT_PINS[index]!,
      label: MCP23017_PORT_PINS[index]!,
      x: 2.54 + (index % 8) * 2.54,
      y: 20.0 + row * 5.08,
    });
  }
  return {
    id: 'mcp23017',
    name: 'I/O expander (MCP23017)',
    category: 'output',
    widthMm: 25.4,
    heightMm: 29.0,
    component: { kind: 'mcp23017' },
    pins,
    bodyColour: '#3b0764',
    legendColour: '#f3e8ff',
  };
}
