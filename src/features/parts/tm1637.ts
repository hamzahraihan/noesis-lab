/**
 * TM1637: a four-digit LED module and the two-wire protocol that drives it.
 *
 * The chip is a display driver with a serial interface and a display
 * register file behind it. A sketch writes the segment patterns into the
 * registers and the chip scans the digits itself, so the glass shows what
 * was written without the sketch multiplexing anything -- which is the whole
 * reason a module like this is bought: two pins instead of twelve.
 *
 * The protocol is the datasheet's, and the datasheet's command table is
 * what this model implements:
 *
 * - `0b11xxxxxx` is an address command: the low six bits say which display
 *   register the bytes that follow go into. The registers are C0 to C5, and
 *   on the four-digit module the first four are the digits and the fifth is
 *   the colon.
 * - `0b10xxxxxx` is the display control: bit 3 says whether the glass is lit
 *   and the low three bits are the duty, which is the brightness.
 * - the bytes after the command are display data, written to the address and
 *   leaving the address one higher.
 *
 * The first byte of a transaction is the command and the rest are data,
 * which is how the chip tells them apart: a segment pattern can look like a
 * command -- the decimal point on its own is `0x80` -- and only the position
 * says which it is. The bench hands the model whole transactions rather than
 * a bit-banged wire, so the framing is the shape of the call.
 *
 * The wire itself is CLK and DIO, and DIO is bidirectional: the chip pulls it
 * low to acknowledge every byte it takes, and answers a key scan on the same
 * line. The bench models the bytes and not the acknowledgement, because the
 * byte seam is where the protocol is; a sketch that wants to know whether a
 * module answered gets nothing back, which is what an unwired module gives.
 *
 * The segment patterns are the standard 7-segment encodings in the bench's
 * own segment order, the same ones the direct-drive glass uses: bit 0 is A,
 * bit 6 is G and bit 7 is the decimal point. On this module the decimal
 * point of the second digit *is* the colon, which is why a colon in the
 * text lights that bit and nothing else.
 */

import type { PartDefinition } from './catalog';
import { SEGMENT_MAP } from './display/sevensegment';

/** Digits the module shows. */
export const TM1637_DIGITS = 4;

/** Display registers the chip keeps: four digits and the colon. */
export const TM1637_REGISTERS = 6;

/** The decimal point, which is the colon on the second digit. */
const DECIMAL_POINT = 0x80;

/** The snapshot's flag byte: bit 0 says the glass is lit. */
export const TM1637_FLAG_LIT = 0x01;

/** Where the duty sits in the snapshot's flag byte. */
export const TM1637_FLAG_DUTY_SHIFT = 1;

/**
 * A four-digit display module.
 *
 * The register file is the state; everything else is a convenience on top of
 * it, so a sketch can write the protocol by hand or print a line of text and
 * let the module encode it.
 */
export class Tm1637 {
  private readonly registers = new Uint8Array(TM1637_REGISTERS);
  private address = 0;
  private displayOn = false;
  private duty = 0;

  /**
   * One transaction: the command byte, then the data bytes that follow it.
   *
   * The command is the first byte of a transaction on the wire, and the data
   * bytes are the rest -- which is how the chip tells them apart, because a
   * segment pattern can look like a command and only the position says which
   * it is. The bench delivers whole transactions rather than a bit-banged
   * wire, so the framing is the call's shape.
   */
  transaction(command: number, data: readonly number[] = []): void {
    const value = command & 0xff;
    if ((value & 0xc0) === 0xc0) {
      // The address command: where the data bytes that follow go.
      this.address = value & 0x3f;
    } else if ((value & 0xc0) === 0x80) {
      // The display control: the glass, and the duty it runs at.
      this.displayOn = (value & 0x08) !== 0;
      this.duty = value & 0x07;
      return;
    }
    for (const byte of data) {
      this.registers[this.address % TM1637_REGISTERS] = byte & 0xff;
      this.address = (this.address + 1) % TM1637_REGISTERS;
    }
  }

  /**
   * Puts the registers back the way they were.
   *
   * For the page, which draws the glass from a snapshot of the worker's
   * registers rather than from the worker itself.
   */
  restore(patterns: readonly number[], lit: boolean, duty: number): void {
    this.registers.fill(0);
    for (let index = 0; index < patterns.length && index < TM1637_REGISTERS; index++) {
      this.registers[index] = patterns[index]! & 0xff;
    }
    this.displayOn = lit;
    this.duty = duty & 0x07;
    this.address = 0;
  }

  /** The four digits' segment patterns, in the order they are shown. */
  get digits(): readonly number[] {
    return Array.from(this.registers.subarray(0, TM1637_DIGITS));
  }

  /** Whether the glass is lit at all. */
  get lit(): boolean {
    return this.displayOn;
  }

  /** The duty the display control asked for: 0 is darkest, 7 is brightest. */
  get brightness(): number {
    return this.duty;
  }

  /**
   * Puts a line of text on the glass.
   *
   * The characters are encoded into the display registers the way the chip
   * would take them, and the colon is the decimal point of the second digit,
   * which is the only place this module has one.
   */
  print(text: string): void {
    const patterns: number[] = [];
    let colon = false;
    for (const character of text) {
      if (character === ':') {
        colon = true;
        continue;
      }
      patterns.push(SEGMENT_MAP[character] ?? SEGMENT_MAP[character.toUpperCase()] ?? 0);
    }
    const digits = patterns.slice(0, TM1637_DIGITS);
    while (digits.length < TM1637_DIGITS) digits.push(0);
    this.transaction(0xc0, digits);
    if (colon) this.registers[1] |= DECIMAL_POINT;
  }

  /**
   * Shows a number, zero-padded to the number of places asked for.
   *
   * A four-digit display counts: past 9999 it keeps the last four digits,
   * which is what a counter on such a display does.
   */
  printNumber(value: number, places = TM1637_DIGITS): void {
    const width = Math.max(1, Math.min(TM1637_DIGITS, Math.floor(places)));
    const text = String(Math.trunc(Math.abs(value))).padStart(width, '0').slice(-width);
    const patterns = text.split('').map((character) => SEGMENT_MAP[character] ?? 0);
    // A negative number shows its sign in the first place, the way a
    // four-digit display with no room for one does.
    if (value < 0 && patterns.length > 0) patterns[0] = SEGMENT_MAP['-'];
    while (patterns.length < TM1637_DIGITS) patterns.push(0);
    this.transaction(0xc0, patterns);
  }

  /**
   * Sets the brightness, 0 to 7.
   *
   * The display control command carries both: the duty is the brightness,
   * and the command with the display bit set is what lights the glass.
   */
  setBrightness(level: number): void {
    this.transaction(0x88 | (Math.max(0, Math.min(7, Math.floor(level))) & 0x07));
  }

  /** The glass's own state, for a renderer that draws the digits. */
  get state(): { patterns: readonly number[]; lit: boolean } {
    return { patterns: this.digits, lit: this.displayOn };
  }
}

/**
 * The module as it is sold: a black board with four red digits and a
 * four-pin header.
 */
export function tm1637Definition(): PartDefinition {
  return {
    id: 'tm1637',
    name: '4-digit LED display (TM1637)',
    category: 'output',
    widthMm: 50.0,
    heightMm: 20.0,
    component: { kind: 'tm1637' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 4.0, y: 17.0, net: 'VCC' },
      { id: 'GND', label: 'GND', x: 7.0, y: 17.0, net: 'GND' },
      { id: 'CLK', label: 'CLK', x: 10.0, y: 17.0 },
      { id: 'DIO', label: 'DIO', x: 13.0, y: 17.0 },
    ],
    bodyColour: '#0b0b0f',
    legendColour: '#f87171',
  };
}
