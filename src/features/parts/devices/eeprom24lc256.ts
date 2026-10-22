/**
 * 24LC256: a memory chip, and a different shape of device.
 *
 * Every other part on the bench is a register file: the sketch writes a
 * register and reads it back. This one is a pointer - the sketch writes an
 * *address* and then the bytes at it - which is the shape almost every
 * memory on the planet has, and the shape the bench's SD card has at a
 * higher level.
 *
 * The address is sixteen bits, so it takes two bytes on the bus, and the
 * write that follows carries the data. A write is bounded by the page: the
 * chip wraps inside its sixty-four byte page rather than running on into
 * the next one, which is a thing a sketch gets wrong once and then never
 * again.
 *
 * The memory is part of the model, so what a sketch writes is still there
 * after the bench is rebuilt - which is not the same as surviving a power
 * cycle, and the bench does not model one.
 */

import type { PartDefinition } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers on, with the address straps open. */
export const EEPROM24LC256_ADDRESS = 0x50;

/** How much the chip holds, in bytes. */
export const EEPROM24LC256_SIZE = 32768;

/**
 * How many bytes a write may cover before it wraps.
 *
 * The page is sixty-four bytes, and the address's low six bits are the
 * position inside it, so a write that runs off the end of a page comes back
 * to the start of that page rather than carrying on.
 */
export const EEPROM24LC256_PAGE_SIZE = 64;

export class Eeprom24lc256 implements I2cDevice {
  readonly address = EEPROM24LC256_ADDRESS;
  onBus = false;

  private readonly bytes = new Uint8Array(EEPROM24LC256_SIZE);
  /** Where the next byte lands, and where a read starts. */
  private pointer = 0;
  /** The high byte of the address, while a write is still naming it. */
  private high = 0;
  /** How many bytes of the address have arrived. */
  private addressBytes = 0;

  /**
   * One written byte.
   *
   * The first two bytes are the address, and the rest is data. The chip
   * takes the address before it takes the data every time, so the model
   * knows which is which by counting rather than by guessing.
   */
  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      // The first byte of a transaction is the high half of the address.
      this.high = byte;
      this.addressBytes = 1;
      return true;
    }
    if (this.addressBytes === 1) {
      this.pointer = (this.high << 8) + byte;
      this.addressBytes = 2;
      return true;
    }
    this.bytes[this.pointer % EEPROM24LC256_SIZE] = byte & 0xff;
    // The write wraps inside its page: the low six bits of the address are
    // the position in the page, and the page starts again at zero.
    const page = this.pointer - (this.pointer % EEPROM24LC256_PAGE_SIZE);
    this.pointer = page + ((this.pointer + 1) % EEPROM24LC256_PAGE_SIZE);
    return true;
  }

  /**
   * A read, from where the last write left the pointer.
   *
   * A read does not name its own address: the master writes the address
   * and then reads, so the pointer is already where it left off.
   */
  read(count: number): readonly number[] {
    const out: number[] = [];
    for (let index = 0; index < Math.max(0, count); index++) {
      out.push(this.bytes[this.pointer % EEPROM24LC256_SIZE] ?? 0);
      this.pointer = (this.pointer + 1) % EEPROM24LC256_SIZE;
    }
    return out;
  }
}

/**
 * The module as it is sold: a small board with the chip on it and the four
 * bus wires.
 */
export function eeprom24lc256Definition(): PartDefinition {
  return {
    id: 'eeprom24lc256',
    name: 'EEPROM (24LC256)',
    category: 'output',
    widthMm: 25.4,
    heightMm: 17.78,
    component: { kind: 'eeprom' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 2.54, y: 4.0, net: 'VCC' },
      { id: 'GND', label: 'GND', x: 5.08, y: 4.0, net: 'GND' },
      { id: 'SDA', label: 'SDA', x: 7.62, y: 4.0 },
      { id: 'SCL', label: 'SCL', x: 10.16, y: 4.0 },
    ],
    bodyColour: '#1c1917',
    legendColour: '#e7e5e4',
  };
}
