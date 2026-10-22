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
  private readonly ram = new Uint8Array(PCD8544_FRAME_BYTES);

  private x = 0;
  private y = 0;

  /** Function set: power down, vertical addressing, extended instruction set. */
  private powerDown = false;
  private vertical = false;
  private extended = false;

  /** Display control: blanked, and the whole-glass inversion. */
  private blanked = true;
  private inverse = false;

  /** Contrast voltage, 0..127. The chip powers up at zero, which is its dimmest. */
  private vop = 0;

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
    this.ram.fill(0);
    this.x = 0;
    this.y = 0;
    this.powerDown = false;
    this.vertical = false;
    this.extended = false;
    this.blanked = true;
    this.inverse = false;
    this.vop = 0;
  }

  private command(byte: number): void {
    /*
     * The two opcodes both instruction sets share are decoded first, because
     * they mean the same thing in either half -- which is what lets a driver
     * leave the extended set without guessing.
     */
    if ((byte & 0xf8) === FUNCTION_SET) {
      this.powerDown = (byte & 0x04) !== 0;
      this.vertical = (byte & 0x02) !== 0;
      this.extended = (byte & 0x01) !== 0;
      return;
    }
    if ((byte & 0xf8) === DISPLAY_CONTROL) {
      this.blanked = (byte & 0x04) === 0;
      this.inverse = (byte & 0x01) !== 0;
      return;
    }
    if (this.extended) {
      // 0x80 takes the contrast voltage; 0x10..0x1F sets the bias and the
      // temperature coefficient, which a bench has no voltage and no
      // temperature to act on. The address commands are unreachable here,
      // which is the reason a driver has to switch back before drawing.
      if (byte & SET_VOP) this.vop = byte & 0x7f;
      return;
    }
    if (byte & SET_X) {
      this.x = Math.min(byte & 0x7f, PCD8544_WIDTH - 1);
      return;
    }
    if ((byte & 0xf8) === SET_Y) {
      this.y = Math.min(byte & 0x07, PCD8544_BANKS - 1);
    }
  }

  private writeData(byte: number): void {
    this.ram[this.y * PCD8544_WIDTH + this.x] = byte;
    if (this.vertical) {
      this.y += 1;
      if (this.y >= PCD8544_BANKS) {
        this.y = 0;
        this.x += 1;
        if (this.x >= PCD8544_WIDTH) this.x = 0;
      }
      return;
    }
    this.x += 1;
    if (this.x >= PCD8544_WIDTH) {
      this.x = 0;
      this.y += 1;
      if (this.y >= PCD8544_BANKS) this.y = 0;
    }
  }

  /** True when the pixel at `x`, `y` is lit, counting from the top left. */
  isLit(x: number, y: number): boolean {
    if (x < 0 || x >= PCD8544_WIDTH || y < 0 || y >= PCD8544_HEIGHT) return false;
    if (this.blanked) return false;
    if (this.powerDown) return false;
    const bit = (this.ram[(y >> 3) * PCD8544_WIDTH + x] ?? 0) >> (y & 7);
    return this.inverse ? (bit & 1) === 0 : (bit & 1) === 1;
  }

  /** The panel's memory, for a renderer that wants to copy it. */
  frame(): Uint8Array {
    return this.ram.slice();
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
      this.ram[index] = (frame[index] ?? 0) & 0xff;
    }
    this.blanked = (flags & PCD8544_FLAG_LIT) === 0;
    this.inverse = (flags & PCD8544_FLAG_INVERSE) !== 0;
    this.vop = Math.max(0, Math.min(0x7f, contrast));
  }

  /** The glass is not blanked. */
  get lit(): boolean {
    return !this.blanked;
  }

  /** Whether the whole glass is drawn inverted. */
  get inverted(): boolean {
    return this.inverse;
  }

  /** 0 at the chip's minimum contrast voltage, 1 at its maximum. */
  get brightness(): number {
    return this.vop / 0x7f;
  }
}

/**
 * The Nokia 5110 module, as the breakout is sold.
 *
 * A 45 mm board with the glass across the top and an eight-pin header along
 * the bottom: reset, chip enable, data/command, data in, clock, supply and the
 * backlight anode. The backlight is a plain pin here -- it is an LED on the
 * board, not a register -- so the bench shows it as the header contact it is.
 */
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
