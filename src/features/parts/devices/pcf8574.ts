/**
 * PCF8574: eight pins in two wires.
 *
 * The chip is an I/O expander, and it is the answer to a problem every
 * project meets: the board has run out of pins. A sketch writes one byte
 * over I2C and eight pins follow it -- the shift register's trick on the
 * other bus, and the same lesson in a different place.
 *
 * The ports are quasi-bidirectional, which is the part's one strange
 * property: every port is a weak pull-up that the chip can pull down, so a
 * port left in the output register reads as high until something pulls it
 * low. The bench models the output side, which is what a sketch uses it for,
 * and does not model reading a pin back -- the port's input register would
 * report the *wiring* rather than what the sketch wrote, and that is a
 * different part of the chip.
 */

import type { PartDefinition } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers on, with the address straps open. */
export const PCF8574_ADDRESS = 0x20;

/** How many ports the chip has. */
export const PCF8574_PORTS = 8;

/**
 * The output stage, in ohms.
 *
 * The chip's ports are quasi-bidirectional: a weak pull-up that the chip can
 * pull down. The bench gives the ports the same output impedance it gives the
 * shift register's, so a driven port reads as a driven pin rather than as a
 * wire floating halfway up.
 */
export const PCF8574_OUTPUT_OHMS = 1000;

/**
 * The output register, and the port the chip reads back.
 *
 * Writing the output register sets the ports; reading it gives back what
 * was written, which is what the chip does -- the input register is the one
 * that reads the wiring, and the bench does not model that.
 */
const OUTPUT_REGISTER = 0x00;
/** The register that reads the ports' levels back. */
export const PCF8574_INPUT_REGISTER = 0x01;

export class Pcf8574 implements I2cDevice {
  readonly address = PCF8574_ADDRESS;
  onBus = false;

  /** The output latch: the ports the chip is driving. */
  private latch = 0xff;
  /** Which register the next byte goes to or comes from. */
  private pointer = OUTPUT_REGISTER;

  /**
   * One written byte.
   *
   * The first byte of a transaction is the register: zero is the output
   * register, one is the input register. A write to the input register is
   * refused, because the chip refuses it too.
   */
  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0x01;
      return true;
    }
    // A write to the input register is refused, because the chip refuses it
    // too: the ports are read-only from the other side.
    if (this.pointer !== OUTPUT_REGISTER) return false;
    this.latch = byte & 0xff;
    return true;
  }

  /**
   * A read, from whichever register the last write named.
   *
   * The output register reads back what was written. The input register
   * reads the levels on the ports, and on the bench the ports are what the
   * chip drives them at, so it reads the same bytes -- the wiring a port
   * shares with something else is the one thing here that is not modelled.
   */
  read(count: number): readonly number[] {
    return Array.from({ length: Math.max(0, count) }, () => this.latch);
  }

  /** The level a port is driving. */
  output(index: number): boolean {
    return (this.latch >> index & 1) === 1;
  }
}

/**
 * The module as it is sold: a small board with the chip on it, the four
 * bus wires and eight ports along the other edge.
 */
export function pcf8574Definition(): PartDefinition {
  const pins = [
    { id: 'VCC', label: 'VCC', x: 2.54, y: 4.0, net: 'VCC' },
    { id: 'GND', label: 'GND', x: 5.08, y: 4.0, net: 'GND' },
    { id: 'SDA', label: 'SDA', x: 7.62, y: 4.0 },
    { id: 'SCL', label: 'SCL', x: 10.16, y: 4.0 },
  ];
  for (let index = 0; index < PCF8574_PORTS; index++) {
    pins.push({
      id: `P${index}`,
      label: `P${index}`,
      x: 2.54 + index * 2.54,
      y: 20.0,
    });
  }
  return {
    id: 'pcf8574',
    name: 'I/O expander (PCF8574)',
    category: 'output',
    widthMm: 25.4,
    heightMm: 23.0,
    component: { kind: 'i2c-expander' },
    pins,
    bodyColour: '#064e3b',
    legendColour: '#d1fae5',
  };
}
