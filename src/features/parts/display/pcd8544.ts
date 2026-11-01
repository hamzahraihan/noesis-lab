/**
 * Nokia 5110 display: a PCD8544 controller and its 84x48 glass.
 *
 * The panel is the same idea as the OLED and a different chip. It has no I2C
 * address, four wires carry it (chip select, data/command, data in and clock),
 * and its memory is 84 columns by six banks of eight rows -- one byte per
 * column per bank, the bit order the glass scans in.
 *
 * Two things make this chip its own model rather than a resized OLED. The
 * instruction set comes in two halves: the basic set sets the address and the
 * display mode, and the extended set swaps the same opcodes for the analogue
 * side -- bias, temperature coefficient and the contrast voltage. A sketch
 * that sets contrast has to turn the extended set on, write it, and turn it
 * off again, and a command byte means something different depending on which
 * half is current. The second is the addressing mode: data writes walk across
 * the columns and wrap down a bank, or walk down the banks and wrap across a
 * column, and a driver that assumes the wrong one draws a transposed picture.
 *
 * The hardware reset line is not modelled. The panel is built in the state a
 * reset leaves it -- basic set, display blanked, address counter at zero -- so
 * the pulse a sketch sends at start-up changes nothing, which is exactly what
 * it does on real hardware at power-up.
 */

import type { PartDefinition, PinSpec } from '../catalog';

/** Columns of RAM, one per pixel across. */
export const PCD8544_WIDTH = 84;

/** Rows of glass. */
export const PCD8544_HEIGHT = 48;

/** Banks of eight rows: the unit the chip addresses. */
export const PCD8544_BANKS = PCD8544_HEIGHT / 8;

/** Bytes a mirrored frame carries: one per column per bank. */
export const PCD8544_FRAME_BYTES = PCD8544_WIDTH * PCD8544_BANKS;

/** Byte positions after a mirrored frame: bit 0 is the glass being on. */
export const PCD8544_FLAGS_BYTES = 2;

/** The display is not blanked. */
export const PCD8544_FLAG_LIT = 1;

/** The whole glass is inverted. */
export const PCD8544_FLAG_INVERSE = 2;

/** The opcode each command shares, with its parameters in the low bits. */
const FUNCTION_SET = 0x20;
const DISPLAY_CONTROL = 0x08;
const SET_Y = 0x40;
const SET_X = 0x80;
const SET_VOP = 0x80;

/**
 * The PCD8544's register file and its glass.
 *
 * Bytes arrive from the SPI bus: a command when D/C is low, a byte of RAM when
 * it is high. Everything the glass shows is derived from the RAM and the two
 * switches (blanked, inverted), so a renderer can ask `isLit()` at any time.
 */
export class Pcd8544 {
  private readonly _ram = new Uint8Array(PCD8544_FRAME_BYTES);

  private _x = 0;
  private _y = 0;

  /** Function set: power down, vertical addressing, extended instruction set. */
  private _powerDown = false;
  private _vertical = false;
  private _extended = false;

  /** Display control: blanked, and the whole-glass inversion. */
  private _blanked = true;
  private _inverse = false;

  /** Contrast voltage, 0..127. The chip powers up at zero, which is its dimmest. */
  private _vop = 0;

  get x(): number { return this._x; }
  set x(v: number) { this._x = v; }
  get y(): number { return this._y; }
  set y(v: number) { this._y = v; }
  get powerDown(): boolean { return this._powerDown; }
  set powerDown(v: boolean) { this._powerDown = v; }
  get vertical(): boolean { return this._vertical; }
  set vertical(v: boolean) { this._vertical = v; }
  get extended(): boolean { return this._extended; }
  set extended(v: boolean) { this._extended = v; }
  get blanked(): boolean { return this._blanked; }
  set blanked(v: boolean) { this._blanked = v; }
  get inverse(): boolean { return this._inverse; }
  set inverse(v: boolean) { this._inverse = v; }
  get vop(): number { return this._vop; }
  set vop(v: number) { this._vop = v; }
  get ram(): Uint8Array { return this._ram; }

  /** One byte from the SPI bus. */
  receive(byte: number, dataSelect: boolean, chipSelected: boolean): void {
    if (!chipSelected) return;
    if (dataSelect) this.writeData(byte & 0xff);
    else this.command(byte & 0xff);
  }

  /**
   * Returns the panel to the state a hardware reset leaves it in.
   *
   * The RAM is cleared as well: the chip does not promise what its memory
   * holds after a reset, and a bench that showed yesterday's picture would be
   * inventing a fact rather than modelling one.
   */
  reset(): void {
    this._ram.fill(0);
    this._x = 0;
    this._y = 0;
    this._powerDown = false;
    this._vertical = false;
    this._extended = false;
    this._blanked = true;
    this._inverse = false;
    this._vop = 0;
  }

  private command(byte: number): void {
    /*
     * The two opcodes both instruction sets share are decoded first, because
     * they mean the same thing in either half -- which is what lets a driver
     * leave the extended set without guessing.
     */
    if ((byte & 0xf8) === FUNCTION_SET) {
      this._powerDown = (byte & 0x04) !== 0;
      this._vertical = (byte & 0x02) !== 0;
      this._extended = (byte & 0x01) !== 0;
      return;
    }
    if ((byte & 0xf8) === DISPLAY_CONTROL) {
      this._blanked = (byte & 0x04) === 0;
      this._inverse = (byte & 0x01) !== 0;
      return;
    }
    if (this._extended) {
      // 0x80 takes the contrast voltage; 0x10..0x1F sets the bias and the
      // temperature coefficient, which a bench has no voltage and no
      // temperature to act on. The address commands are unreachable here,
      // which is the reason a driver has to switch back before drawing.
      if (byte & SET_VOP) this._vop = byte & 0x7f;
      return;
    }
    if (byte & SET_X) {
      this._x = Math.min(byte & 0x7f, PCD8544_WIDTH - 1);
      return;
    }
    if ((byte & 0xf8) === SET_Y) {
      this._y = Math.min(byte & 0x07, PCD8544_BANKS - 1);
    }
  }

  private writeData(byte: number): void {
    this._ram[this._y * PCD8544_WIDTH + this._x] = byte;
    if (this._vertical) {
      this._y += 1;
      if (this._y >= PCD8544_BANKS) {
        this._y = 0;
        this._x += 1;
        if (this._x >= PCD8544_WIDTH) this._x = 0;
      }
      return;
    }
    this._x += 1;
    if (this._x >= PCD8544_WIDTH) {
      this._x = 0;
      this._y += 1;
      if (this._y >= PCD8544_BANKS) this._y = 0;
    }
  }

  /** True when the pixel at `x`, `y` is lit, counting from the top left. */
  isLit(x: number, y: number): boolean {
    if (x < 0 || x >= PCD8544_WIDTH || y < 0 || y >= PCD8544_HEIGHT) return false;
    if (this._blanked) return false;
    if (this._powerDown) return false;
    const bit = (this._ram[(y >> 3) * PCD8544_WIDTH + x] ?? 0) >> (y & 7);
    return this._inverse ? (bit & 1) === 0 : (bit & 1) === 1;
  }

  /** The panel's memory, for a renderer that wants to copy it. */
  frame(): Uint8Array {
    return this._ram.slice();
  }

  /**
   * Rebuilds the panel from a mirrored frame.
   *
   * The snapshot path, not a sketch path: the page holds the worker's frame
   * and has to show it without replaying the commands that drew it. The
   * address counter and the extended set are not part of a picture, so they
   * keep the reset values both sides start from.
   */
  restore(frame: ArrayLike<number>, flags: number, contrast: number): void {
    for (let index = 0; index < PCD8544_FRAME_BYTES; index++) {
      this._ram[index] = (frame[index] ?? 0) & 0xff;
    }
    this._blanked = (flags & PCD8544_FLAG_LIT) === 0;
    this._inverse = (flags & PCD8544_FLAG_INVERSE) !== 0;
    this._vop = Math.max(0, Math.min(0x7f, contrast));
  }

  /** The display is not blanked. */
  get lit(): boolean {
    return !this._blanked;
  }

  /** Brightness as a 0..1 value (alias for vop scaled to 0..1). */
  get brightness(): number {
    return this._vop / 0x7f;
  }

  /** Whether the display is inverted (alias for inverse). */
  get inverted(): boolean {
    return this._inverse;
  }
}

export function nokia5110Definition(): PartDefinition {
  const pitch = 2.54;
  const pins: PinSpec[] = [];
  const order: ReadonlyArray<readonly [string, string]> = [
    ['RESET', 'RST'],
    ['CS', 'CE'],
    ['DC', 'DC'],
    ['MOSI', 'DIN'],
    ['SCK', 'CLK'],
    ['VCC', 'VCC'],
    ['BL', 'BL'],
    ['GND', 'GND'],
  ];
  const firstX = (45.0 - (order.length - 1) * pitch) / 2;
  order.forEach(([id, label], index) => {
    pins.push({
      id,
      label,
      x: firstX + index * pitch,
      y: 39.5,
      net: id === 'GND' ? 'GND' : id === 'VCC' ? 'VCC' : undefined,
    });
  });

  return {
    id: 'nokia-5110',
    name: 'Nokia 5110 LCD (PCD8544)',
    category: 'output',
    widthMm: 45.0,
    heightMm: 45.0,
    component: { kind: 'display', controller: 'pcd8544', address: 0 },
    pins,
    bodyColour: '#0e1b12',
    legendColour: '#bbf7d0',
    displayPixels: { width: PCD8544_WIDTH, height: PCD8544_HEIGHT },
    glassMm: { width: 43.0, height: 25.2 },
  };
}