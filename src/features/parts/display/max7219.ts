/**
 * MAX7219 8x8 LED matrix module: the chip's register file, and the glass it
 * drives.
 *
 * The module is a MAX7219 with an 8x8 dot matrix soldered to its digit and
 * segment drivers: DIGIT0..DIGIT7 are the eight columns, and each register's
 * bits are the eight rows of that column. The sketch never addresses a pixel.
 * It shifts 16-bit frames -- an address nibble and a data byte -- up the SPI
 * wires, and the chip holds every register until the next frame overwrites it.
 *
 * Framing is the chip-select rise rather than the byte. The chip's shift
 * register is exactly sixteen bits wide, so a transaction that sends four
 * frames without raising chip-select between them leaves only the last in the
 * register, and only that one is latched. That is the chip's own behaviour, and
 * a sketch that leaves its chip-select low sees exactly this.
 *
 * Four registers change what the glass shows. Shutdown (0x0C) blanks the
 * display while keeping every digit register, which is the chip's power-up
 * state. The intensity register (0x0A) sets the LED current, and it is the only
 * brightness control the chip has -- at its power-up value of zero the glass is
 * as dim as the chip can make it. The scan limit (0x0B) stops the multiplex at
 * a column, which is how a four-digit module is made from the same chip.
 * Decode mode (0x09) would replace a digit register with the segment pattern of
 * a seven-segment font; a matrix sketch leaves it off, and this model ignores it
 * for the same reason.
 */

import type { PartDefinition, PinSpec } from '../catalog';

/** Columns in the module's glass, one per DIGIT register. */
export const MAX7219_COLUMNS = 8;

/** Rows in the module's glass, one per bit of a DIGIT register. */
export const MAX7219_ROWS = 8;

/** Address of the first digit register; DIGIT1..DIGIT7 follow it. */
const DIGIT_0 = 0x01;
const DECODE_MODE = 0x09;
const INTENSITY = 0x0a;
const SCAN_LIMIT = 0x0b;
const SHUTDOWN = 0x0c;
const DISPLAY_TEST = 0x0f;

/** Bytes a mirrored frame carries: one per column register. */
export const MAX7219_FRAME_BYTES = MAX7219_COLUMNS;

/** The flags byte after a mirrored frame: bit 0 is the chip being awake. */
export const MAX7219_FLAG_LIT = 1;

/** Where the intensity nibble sits in the flags byte. */
export const MAX7219_INTENSITY_SHIFT = 4;

/**
 * The MAX7219's serial interface and its glass.
 *
 * Bytes arrive from the SPI bus; `latch()` is the chip-select rise. Everything
 * the glass shows is derived from the register file, so a renderer can ask
 * `isLit()` on any solve without the model having to remember a frame.
 */
export class Max7219 {
  /** One register per column: bit n is the LED at row n. */
  private readonly columns = new Uint8Array(MAX7219_COLUMNS);

  /** The sixteen-bit shift register, filled from the top as bytes arrive. */
  private shift = 0;
  private bits = 0;

  /*
   * The chip's power-up state: shut down, every digit register clear, the scan
   * limit at all eight columns. The scan limit matters here rather than being
   * left at zero because a chip whose multiplex stopped at one column would
   * only ever light the leftmost, and every sketch that draws a matrix writes
   * 0x0B before it draws -- so a model that started at one column would make a
   * correct sketch look broken.
   */
  private shutdown = true;
  private intensity = 0;
  private scanLimit = MAX7219_COLUMNS - 1;
  private testMode = false;

  /**
   * One byte from the SPI bus.
   *
   * `dataSelect` is ignored: the module has no D/C pin, because everything it
   * receives is a register write. `chipSelected` is ignored too -- a byte
   * reaches the shift register whether or not a chip-select is low, exactly as
   * the chip shifts on every clock edge -- and the rise is what applies it.
   */
  receive(byte: number, _dataSelect: boolean, _chipSelected: boolean): void {
    this.shift = ((this.shift << 8) | (byte & 0xff)) & 0xffff;
    this.bits = Math.min(this.bits + 8, 16);
  }

  /**
   * The chip-select rise: whatever sixteen bits are in the register take
   * effect.
   *
   * A transfer too short to hold a whole frame is dropped, which is what makes
   * a sketch that moves chip-select halfway through a write show half a
   * picture rather than a picture it never sent.
   */
  latch(): void {
    if (this.bits >= 16) this.write(this.shift);
    this.shift = 0;
    this.bits = 0;
  }

  private write(frame: number): void {
    const address = (frame >> 8) & 0x0f;
    const data = frame & 0xff;
    if (address >= DIGIT_0 && address < DIGIT_0 + MAX7219_COLUMNS) {
      this.columns[address - DIGIT_0] = data;
      return;
    }
    switch (address) {
      case DECODE_MODE:
        // Recorded, not applied: the font would only matter to a seven-segment
        // glass, and this glass is a matrix.
        break;
      case INTENSITY:
        this.intensity = data & 0x0f;
        break;
      case SCAN_LIMIT:
        this.scanLimit = Math.min(data & 0x07, MAX7219_COLUMNS - 1);
        break;
      case SHUTDOWN:
        this.shutdown = (data & 1) === 0;
        break;
      case DISPLAY_TEST:
        this.testMode = (data & 1) === 1;
        break;
    }
  }

  /** True when the LED at `column`, `row` is lit, counting from the top left. */
  isLit(column: number, row: number): boolean {
    if (column < 0 || column >= MAX7219_COLUMNS || row < 0 || row >= MAX7219_ROWS) return false;
    if (this.shutdown) return false;
    if (this.testMode) return true;
    if (column > this.scanLimit) return false;
    return (((this.columns[column] ?? 0) >> row) & 1) === 1;
  }

  /** The column registers, for a renderer that wants to copy them. */
  frame(): Uint8Array {
    return this.columns.slice();
  }

  /**
   * Rebuilds the register file from a mirrored frame.
   *
   * This is the snapshot path, not a sketch path: the page holds the worker's
   * frame and has to show it without replaying the transaction that made it.
   * The registers a frame does not carry -- scan limit, test mode -- keep the
   * power-up values both sides start from.
   */
  restore(columns: ArrayLike<number>, flags: number): void {
    for (let index = 0; index < MAX7219_COLUMNS; index++) {
      this.columns[index] = (columns[index] ?? 0) & 0xff;
    }
    this.intensity = (flags >> MAX7219_INTENSITY_SHIFT) & 0x0f;
    this.shutdown = (flags & MAX7219_FLAG_LIT) === 0;
  }

  /** The chip is not shut down: the glass is showing something. */
  get lit(): boolean {
    return !this.shutdown;
  }

  /** 0 at the chip's minimum current, 1 at its maximum. */
  get brightness(): number {
    return this.intensity / 0x0f;
  }
}

/**
 * The MAX7219 8x8 matrix module, as it is sold.
 *
 * A 32 mm square board with the glass in the middle and five pins along one
 * edge. The chain output (DOUT) is not on this module's header: it exists for
 * cascading modules, which needs the chip's own latch timing on every module
 * and is not what a first matrix exercise is about.
 */
export function max7219Definition(): PartDefinition {
  const pitch = 2.54;
  const pins: PinSpec[] = [];
  const order: ReadonlyArray<readonly [string, string]> = [
    ['VCC', 'VCC'],
    ['GND', 'GND'],
    ['DIN', 'DIN'],
    ['CS', 'CS'],
    ['CLK', 'CLK'],
  ];
  const firstX = (32.2 - (order.length - 1) * pitch) / 2;
  order.forEach(([id, label], index) => {
    pins.push({
      id,
      label,
      x: firstX + index * pitch,
      y: 29.0,
      net: id === 'GND' ? 'GND' : id === 'VCC' ? '5V' : undefined,
    });
  });

  return {
    id: 'max7219-matrix',
    name: '8x8 LED matrix (MAX7219)',
    category: 'output',
    widthMm: 32.2,
    heightMm: 32.2,
    component: { kind: 'display', controller: 'max7219', address: 0 },
    pins,
    bodyColour: '#0d1014',
    legendColour: '#fbbf24',
    displayPixels: { width: MAX7219_COLUMNS, height: MAX7219_ROWS },
  };
}
