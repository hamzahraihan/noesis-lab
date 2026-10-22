import { describe, expect, it } from 'vitest';
import { eeprom24lc256Definition, Eeprom24lc256, EEPROM24LC256_PAGE_SIZE } from './eeprom24lc256';

/** A write: the address, two bytes, and then the data. */
function write(memory: Eeprom24lc256, address: number, ...data: number[]): void {
  memory.receive((address >> 8) & 0xff, true);
  memory.receive(address & 0xff, false);
  for (const byte of data) memory.receive(byte, false);
}

/**
 * A read: the master writes the address and then reads, so the address is
 * named again before the bytes come back.
 */
function readFrom(memory: Eeprom24lc256, address: number, count: number): readonly number[] {
  memory.receive((address >> 8) & 0xff, true);
  memory.receive(address & 0xff, false);
  return memory.read(count);
}

describe('the 24LC256', () => {
  it('puts a byte where the address said and reads it back', () => {
    const memory = new Eeprom24lc256();
    write(memory, 0x0040, 0x5a);
    expect(readFrom(memory, 0x0040, 1)).toEqual([0x5a]);
  });

  it('takes a sixteen-bit address', () => {
    const memory = new Eeprom24lc256();
    write(memory, 0x0100, 0x11);
    expect(readFrom(memory, 0x0100, 1)).toEqual([0x11]);
    write(memory, 0x0000, 0x22);
    expect(readFrom(memory, 0x0000, 1)).toEqual([0x22]);
  });

  it('reads on from the address it was given', () => {
    const memory = new Eeprom24lc256();
    write(memory, 0x0010, 0x01, 0x02, 0x03);
    expect(readFrom(memory, 0x0010, 3)).toEqual([0x01, 0x02, 0x03]);
  });

  it('wraps a write inside its page', () => {
    const memory = new Eeprom24lc256();
    // A page starts sixty-four bytes in; a write that runs past its end
    // comes back to the start of the page rather than carrying on.
    const start = EEPROM24LC256_PAGE_SIZE - 1;
    write(memory, start, 0xaa, 0xbb);
    // The first byte lands on the last byte of the page and the second comes
    // back to the start of it.
    expect(readFrom(memory, start, 1)).toEqual([0xaa]);
    expect(readFrom(memory, 0, 1)).toEqual([0xbb]);
  });

  it('keeps what was written', () => {
    const memory = new Eeprom24lc256();
    write(memory, 0x0000, 0x99);
    expect(readFrom(memory, 0x0000, 1)).toEqual([0x99]);
  });
});

describe('the 24LC256 module', () => {
  it('is a memory with the two bus wires', () => {
    const definition = eeprom24lc256Definition();
    expect(definition.component).toEqual({ kind: 'eeprom' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['VCC', 'GND', 'SDA', 'SCL']);
  });
});
