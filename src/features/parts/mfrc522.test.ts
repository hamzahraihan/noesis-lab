import { describe, expect, it } from 'vitest';
import { mfrc522Definition, MFRC522_CARD_KNOB, Mfrc522 } from './mfrc522';

/** One register write, framed the way the bus does it: address, data, rise. */
function write(reader: Mfrc522, register: number, value: number): void {
  reader.receive((register << 1) & 0x7e);
  reader.receive(value);
  reader.endTransaction();
}

/** One register read: the address with bit 7 set, then a dummy byte. */
function read(reader: Mfrc522, register: number): number {
  reader.receive((register << 1) | 0x80);
  const value = reader.receive(0);
  reader.endTransaction();
  return value;
}

/** Turns both antenna drivers on, the way a driver's antenna-on does. */
function antennaOn(reader: Mfrc522): void {
  write(reader, 0x14, 0x03);
}

/** The sequence a driver runs to ask a card to identify itself. */
function requestA(reader: Mfrc522): void {
  write(reader, 0x01, 0x00);
  write(reader, 0x04, 0x7f);
  write(reader, 0x0a, 0x80);
  write(reader, 0x09, 0x26);
  write(reader, 0x01, 0x0c);
  write(reader, 0x0d, 0x87);
}

describe('the MFRC522', () => {
  it('reports its version through a read transaction', () => {
    const reader = new Mfrc522();
    expect(read(reader, 0x37)).toBe(0x92);
  });

  it('keeps a register a driver wrote', () => {
    const reader = new Mfrc522();
    write(reader, 0x2a, 0x8d);
    expect(read(reader, 0x2a)).toBe(0x8d);
  });

  it('reports silence as the timer interrupt when no card is there', () => {
    const reader = new Mfrc522();
    antennaOn(reader);
    requestA(reader);

    expect(read(reader, 0x04) & 0x20).toBe(0);
    expect(read(reader, 0x04) & 0x01).toBe(0x01);
    expect(read(reader, 0x0a)).toBe(0);
  });

  it('answers REQA with the card ATQA and the receive interrupt', () => {
    const reader = new Mfrc522();
    reader.setCardPresent(() => true);
    antennaOn(reader);
    requestA(reader);

    expect(read(reader, 0x04) & 0x20).toBe(0x20);
    expect(read(reader, 0x0a)).toBe(2);
    expect(read(reader, 0x09)).toBe(0x04);
    expect(read(reader, 0x09)).toBe(0x00);
  });

  it('walks the address counter across the register file on a burst read', () => {
    const reader = new Mfrc522();
    reader.setCardPresent(() => true);
    antennaOn(reader);
    requestA(reader);

    reader.receive((0x09 << 1) | 0x80);
    const first = reader.receive(0);
    const second = reader.receive(0);
    const third = reader.receive(0);
    reader.endTransaction();

    // The counter walks out of the FIFO into FIFOLevelReg and then on into
    // WaterLevelReg, which is why a driver reads the FIFO a byte at a time
    // rather than bursting the whole answer.
    expect([first, second, third]).toEqual([0x04, 1, 0]);
  });

  it('clears the interrupts a driver writes back and flushes the FIFO', () => {
    const reader = new Mfrc522();
    reader.setCardPresent(() => true);
    antennaOn(reader);
    requestA(reader);

    write(reader, 0x04, 0x7f);
    expect(read(reader, 0x04)).toBe(0);

    write(reader, 0x0a, 0x80);
    expect(read(reader, 0x0a)).toBe(0);
  });

  it('returns to its reset state on a soft reset, version and all', () => {
    const reader = new Mfrc522();
    write(reader, 0x2a, 0x8d);
    write(reader, 0x01, 0x0f);

    expect(read(reader, 0x2a)).toBe(0);
    expect(read(reader, 0x37)).toBe(0x92);
  });

  it('hears nothing while its antenna is off, card or no card', () => {
    const reader = new Mfrc522();
    reader.setCardPresent(() => true);
    write(reader, 0x14, 0x01);
    requestA(reader);

    expect(read(reader, 0x04) & 0x20).toBe(0);
    expect(read(reader, 0x04) & 0x01).toBe(0x01);
    expect(read(reader, 0x0a)).toBe(0);
  });
});

describe('the MFRC522 module', () => {
  it('is a reader with the eight header contacts and a card knob', () => {
    const definition = mfrc522Definition();
    expect(definition.component).toEqual({ kind: 'rc522' });
    expect(definition.pins.map((pin) => pin.id)).toEqual([
      'SDA',
      'SCK',
      'MOSI',
      'MISO',
      'IRQ',
      'GND',
      'RST',
      '3V3',
    ]);
    expect(definition.knobs).toEqual([MFRC522_CARD_KNOB]);
  });
});
