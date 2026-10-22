/**
 * MFRC522: a 13.56 MHz card reader as a register file, and the card in its
 * field.
 *
 * The chip is the bench's first SPI device that answers. A display only ever
 * receives; this one has a bus of its own on the silicon -- a FIFO, a command
 * register, an interrupt register and a hundred knobs for the analogue front
 * end -- and a sketch reads it back over MISO one register at a time.
 *
 * What is modelled is the path a sketch actually drives to see a card: the
 * antenna is turned on, a REQA frame is queued in the FIFO, the transceive
 * command is started, and the answer comes back in the FIFO with the receive
 * interrupt set. The rest of the register file is a latch: writes are kept and
 * read back, because a driver writes the whole configuration before it looks
 * at a card, and a chip that lost those writes would look broken for a reason
 * that has nothing to do with the card.
 *
 * The card is a knob, not a simulation of the anticollision protocol: a card
 * present answers REQA and WUPA with its ATQA (0x04 0x00, a MIFARE Classic
 * 1K), and anything else is silence. Selecting a card, its sector keys and its
 * blocks are not modelled, and a sketch that goes looking for them will find
 * the timeout it would find with an incompatible card.
 */

import type { KnobSpec, PartDefinition } from './catalog';

/** The card the reader sees, as the operator sets it. */
export const MFRC522_CARD_KNOB: KnobSpec = {
  id: 'card',
  label: 'Card in field',
  min: 0,
  max: 1,
  step: 1,
  toggle: true,
  defaultValue: 0,
};

/** Registers a driver reads back, by the address in its low six bits. */
const COMMAND = 0x01;
const COM_IRQ = 0x04;
const ERROR = 0x06;
const FIFO_DATA = 0x09;
const FIFO_LEVEL = 0x0a;
const BIT_FRAMING = 0x0d;
const TX_CONTROL = 0x14;
const VERSION = 0x37;

/** CommandReg values that matter here, as the driver names them. */
const CMD_IDLE = 0x00;
const CMD_TRANSCEIVE = 0x0c;
const CMD_SOFT_RESET = 0x0f;

/** ComIrqReg bits: a timer ran out, and a frame came back. */
const IRQ_TIMER = 0x01;
const IRQ_RX = 0x20;
const IRQ_IDLE = 0x10;

/** BitFramingReg bit 7: start the transmission now. */
const START_SEND = 0x80;

/** The two short frames a reader uses to find a card at all. */
const REQA = 0x26;
const WUPA = 0x52;

/** ATQA of a MIFARE Classic 1K: what the card answers REQA with. */
const MIFARE_CLASSIC_ATQA = 0x0400;

/** The chip's own version register: v2.0, which every module reports. */
const VERSION_2 = 0x92;

/** FIFO depth the datasheet gives, in bytes. */
const FIFO_DEPTH = 64;

/**
 * The MFRC522's register file and its FIFO.
 *
 * Bytes arrive one at a time: the first of a transaction is an address, with
 * bit 7 saying read or write, and the second is the data. A read answers on
 * MISO; a write answers zero, because the chip has nothing to say while it is
 * listening.
 */
export class Mfrc522 {
  private readonly registers = new Uint8Array(64);
  private readonly fifo: number[] = [];
  private address = 0;
  private writing = false;
  private expectAddress = true;
  private command = CMD_IDLE;
  private cardPresent: () => boolean = () => false;

  constructor() {
    this.reset();
  }

  /** Where the chip's answer to "is a card there" comes from. */
  setCardPresent(source: () => boolean): void {
    this.cardPresent = source;
  }

  /** One byte from the bus: an address when the transaction starts, then data. */
  receive(byte: number): number {
    if (this.expectAddress) {
      this.expectAddress = false;
      this.writing = (byte & 0x80) === 0;
      this.address = (byte >> 1) & 0x3f;
      return 0;
    }
    if (this.writing) {
      this.writeRegister(this.address, byte & 0xff);
      return 0;
    }
    const value = this.readRegister(this.address);
    // A burst read walks the registers, the way the chip's address counter
    // does; the next transaction starts with an address again.
    this.address = (this.address + 1) & 0x3f;
    return value;
  }

  /** The chip-select rise: the next byte is an address again. */
  endTransaction(): void {
    this.expectAddress = true;
  }

  /**
   * True while the antenna is driven.
   *
   * TxControlReg's two low bits enable the two driver pins; a reader with
   * either off has no field, and a card in it is a card nobody asks.
   */
  private get antennaDriven(): boolean {
    return (this.registers[TX_CONTROL]! & 0x03) === 0x03;
  }

  private reset(): void {
    this.registers.fill(0);
    this.fifo.length = 0;
    this.command = CMD_IDLE;
    this.address = 0;
    this.expectAddress = true;
    this.registers[VERSION] = VERSION_2;
  }

  private readRegister(address: number): number {
    switch (address) {
      case FIFO_DATA:
        return this.fifo.shift() ?? 0;
      case FIFO_LEVEL:
        return this.fifo.length;
      default:
        return this.registers[address] ?? 0;
    }
  }

  private writeRegister(address: number, value: number): void {
    switch (address) {
      case COMMAND:
        this.command = value & 0x0f;
        if (this.command === CMD_SOFT_RESET) this.reset();
        return;
      case FIFO_DATA:
        if (this.fifo.length < FIFO_DEPTH) this.fifo.push(value);
        return;
      case FIFO_LEVEL:
        // Bit 7 flushes the FIFO; the level bits are read-only.
        if (value & 0x80) this.fifo.length = 0;
        return;
      case COM_IRQ:
        // Writing one clears that interrupt, which is how a driver waits for
        // the next one.
        this.registers[COM_IRQ] = (this.registers[COM_IRQ] ?? 0) & ~value;
        return;
      case ERROR:
        this.registers[ERROR] = value & 0x7f;
        return;
      case BIT_FRAMING:
        this.registers[BIT_FRAMING] = value;
        if (value & START_SEND) this.transceive();
        return;
      default:
        this.registers[address] = value;
    }
  }

  /**
   * Runs the frame sitting in the FIFO, if the chip was told to.
   *
   * A reader that starts a transmission with no card in its field hears
   * nothing, and silence is reported the way the chip reports it: the timer
   * interrupt, not an error. A reader whose antenna is off has no field to
   * put a card in, so it hears the same nothing.
   */
  private transceive(): void {
    if (this.command !== CMD_TRANSCEIVE) return;
    const frame = this.fifo[0];
    this.fifo.length = 0;
    this.command = CMD_IDLE;
    this.registers[COMMAND] = CMD_IDLE;
    if ((frame === REQA || frame === WUPA) && this.antennaDriven && this.cardPresent()) {
      this.fifo.push((MIFARE_CLASSIC_ATQA >> 8) & 0xff, MIFARE_CLASSIC_ATQA & 0xff);
      this.registers[COM_IRQ] = (this.registers[COM_IRQ] ?? 0) | IRQ_RX | IRQ_IDLE;
      return;
    }
    this.registers[COM_IRQ] = (this.registers[COM_IRQ] ?? 0) | IRQ_TIMER;
  }
}

/**
 * The MFRC522 module as it is sold: a red board with a coil printed round the
 * edge, an eight-pin header along the bottom, and the chip in the middle.
 */
export function mfrc522Definition(): PartDefinition {
  /*
   * The board as it is sold: 40 mm by 60 mm, with the eight-pin header along
   * one short edge at the usual 2.54 mm pitch. The pins do not sit on a
   * breadboard -- the module is wider than one -- so a starter sketch is
   * fly-wired, which is also how the real thing is used.
   */
  const pitch = 2.54;
  const pins = ['SDA', 'SCK', 'MOSI', 'MISO', 'IRQ', 'GND', 'RST', '3V3'].map((id, index) => ({
    id,
    label: id,
    x: 11.1 + index * pitch,
    y: 52.0,
    net: id === 'GND' ? 'GND' : id === '3V3' ? 'VCC' : undefined,
  }));

  return {
    id: 'mfrc522',
    name: 'RFID reader (MFRC522)',
    category: 'input',
    widthMm: 40.0,
    heightMm: 60.0,
    component: { kind: 'rc522' },
    pins,
    knobs: [MFRC522_CARD_KNOB],
    bodyColour: '#7f1d1d',
    legendColour: '#fee2e2',
  };
}
