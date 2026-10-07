/**
 * ILI9341 TFT controller: the 320x240 panel behind the usual SPI breakout.
 *
 * The model speaks the real protocol rather than a friendly API, because the
 * protocol is the lesson. On SPI a display has no control byte to disambiguate
 * things: the D/C pin alone says whether a byte is a command or data, and
 * chip-select rising is what ends a command sequence. Get D/C on the wrong pin
 * and every command arrives as pixel data, which fills the panel with noise
 * instead of drawing anything.
 *
 * Pixels are RGB565, two bytes each, written in the order the address pointer
 * walks them.
 */

import {
  GLYPH_ADVANCE,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  glyphFor,
  measureText,
} from './font5x7';

export const ILI9341_WIDTH = 320;
export const ILI9341_HEIGHT = 240;

/**
 * The 3.2" panel, which is the same controller on a bigger piece of glass.
 *
 * A 3.2" module is an ILI9341 driving 480x320 rather than 320x240. The chip
 * does not know the difference: it has a 320x240 RAM behind it either way and
 * writes it out through the panel's own address wiring, which is why the
 * larger size arrives as a different panel rather than a different chip.
 */
export const ILI9341_LARGE_WIDTH = 480;
export const ILI9341_LARGE_HEIGHT = 320;

/**
 * The four orientations a panel can be held in.
 *
 * They are the values a sketch passes to `tft.setRotation()`, and they are the
 * two bits MADCTL actually controls: the axes swap (MV), and the rows and
 * columns each reverse (MX, MY). Everything else MADCTL carries is colour
 * order and refresh detail, which does not change where a pixel lands.
 */
export type PanelRotation = 0 | 1 | 2 | 3;

/** MADCTL, memory access control. */
const MADCTL = 0x36;

/** Row/column address order: mirror each axis back to front. */
const MADCTL_MX = 0x40;
const MADCTL_MY = 0x80;
/** Memory access: swap the row and column axes over. */
const MADCTL_MV = 0x20;

/**
 * The MADCTL byte for each of the four orientations.
 *
 * Orientation 0 is portrait-as-manufactured: no swap, no mirror. Turning the
 * panel a quarter turn is `MV`, and the two intermediate ones are a swap with
 * one axis reversed, which is a 180 degree turn of a portrait panel and not
 * something else.
 */
const ROTATION_MADCTL: Readonly<Record<PanelRotation, number>> = {
  0: MADCTL_MY,
  1: MADCTL_MV | MADCTL_MX,
  2: MADCTL_MY | MADCTL_MX,
  3: MADCTL_MV,
};



/**
 * How many parameter bytes each command consumes.
 *
 * As with the SSD1306, a wrong count is destructive in a quiet way: the bytes
 * that follow get eaten as arguments, and the failure looks like a dead panel
 * rather than a parse error.
 */
const ARGUMENT_COUNTS: Readonly<Record<number, number>> = {
  0x03: 1, // power control B
  0x0c: 1, // power control C
  0x2a: 4, // column address set: start hi/lo, end hi/lo
  0x2b: 4, // page address set: start hi/lo, end hi/lo
  0x30: 0, // partial lines
  0x31: 2, // partial spacing
  0x33: 4, // partial mode
  0x36: 1, // memory access control
  0x3a: 1, // pixel format set
  0xb1: 2, // frame rate
  0xb6: 3, // display function
  0xc0: 2, // power control A
  0xc1: 1, // power control
  0xc5: 3, // VCOM control
  0xc7: 1, // VCOM control 2
  0xe0: 15, // gamma
  0xe1: 15, // negative gamma
  0xed: 2, // power control sequence
  0xf6: 3, // interface control
};

/** Commands that switch the controller into a streaming pixel mode. */
const STREAM_COMMANDS = new Set([0x2c, 0x2d, 0x3c, 0x2e, 0x3e]);

export class Ili9341 {
  /**
   * The panel's RAM, one entry per pixel, as the controller holds it.
   *
   * This is the panel's own memory rather than what the user sees: a 3.2"
   * module is a 320x480 RAM read out at 480x320 when it is held sideways.
   * Rotation never resizes this -- it changes the way it is walked.
   */
  private readonly framebuffer: Uint8Array;

  private readonly ramWidth: number;
  private readonly ramHeight: number;

  private displayOn = false;
  /** The last MADCTL byte the panel was sent, which is its orientation. */
  private madctl = 0;

  private columnStart = 0;
  private columnEnd = 0;
  private pageStart = 0;
  private pageEnd = 0;

  /**
   * Builds a controller for a panel of the given RAM size.
   *
   * The size is the panel's memory, not the shape a user sees: a 3.2" module
   * is 320x480 here and reads out sideways as 480x320. A sketch asks which it
   * is looking at through `width` and `height`, which is what a real library
   * does rather than assuming a panel is always landscape.
   */
  constructor(width = ILI9341_WIDTH, height = ILI9341_HEIGHT) {
    this.ramWidth = width;
    this.ramHeight = height;
    this.framebuffer = new Uint8Array(width * height * 2);
    this.columnEnd = width - 1;
    this.pageEnd = height - 1;
  }

  /** Visible width: the RAM, or its other side when the panel is turned. */
  get width(): number {
    return this.rotation & 1 ? this.ramHeight : this.ramWidth;
  }

  /** Visible height: the RAM, or its other side when the panel is turned. */
  get height(): number {
    return this.rotation & 1 ? this.ramWidth : this.ramHeight;
  }

  /**
   * Which way up the panel is being read, as `tft.setRotation()` numbered it.
   *
   * Derived from the MADCTL byte rather than remembered separately, so a
   * sketch that writes the register directly and one that calls `setRotation`
   * end up in exactly the same state -- which is what makes the register worth
   * modelling rather than just accepting.
   */
  get rotation(): PanelRotation {
    const axes = this.madctl & (MADCTL_MX | MADCTL_MY | MADCTL_MV);
    for (const rotation of [0, 1, 2, 3] as const) {
      if ((ROTATION_MADCTL[rotation] & (MADCTL_MX | MADCTL_MY | MADCTL_MV)) === axes) {
        return rotation;
      }
    }
    return 0;
  }

  /** Where the next pixel byte lands, within the active window. */
  private cursorColumn = 0;
  private cursorPage = 0;
  /** RGB565 arrives high byte first. */
  private expectHighByte = true;

  private expecting = 0;
  private commandInFlight = 0;
  private argumentIndex = 0;
  private streaming = false;
  private argumentHigh = 0;

  /**
   * Accepts one byte of an SPI transfer.
   *
   * `dataSelect` is the D/C pin: false means the byte is a command, true means
   * data. `chipSelected` going false means chip-select has risen, which
   * abandons any half-finished command -- exactly as the real controller does,
   * and the reason a sketch that toggles CS mid-command silently loses it.
   */
  receive(byte: number, dataSelect: boolean, chipSelected: boolean): void {
    if (!chipSelected) {
      this.expecting = 0;
      this.streaming = false;
      return;
    }

    if (!dataSelect) {
      this.executeCommand(byte);
      return;
    }

    if (this.streaming) {
      this.writePixelByte(byte);
      return;
    }

    if (this.expecting > 0) {
      // Address commands carry 16-bit values, so arguments arrive as
      // high/low pairs. Pairing the *first* high byte with every low byte would
      // quietly set the window to 0..63 instead of 0..319.
      if (this.argumentIndex % 2 === 0) this.argumentHigh = byte;
      const paired = this.argumentIndex % 2 === 1;
      this.applyArgument(paired ? (this.argumentHigh << 8) | byte : byte, this.argumentIndex);
      this.argumentIndex++;
      this.expecting--;
    }
  }

  isOn(): boolean {
    return this.displayOn;
  }

  /**
   * Whether the panel is being read back to front.
   *
   * Kept because it was the one orientation fact the panel exposed before
   * rotation existed, and because a sketch can still ask the question MADCTL
   * answers without wanting a whole orientation.
   */
  get isMirrored(): boolean {
    return (this.madctl & (MADCTL_MX | MADCTL_MY)) !== 0;
  }

  /**
   * The four numbers that turn a visible coordinate into a RAM address.
   *
   * Rotation is four booleans, but this is a hot path: rendering a 480x320
   * panel walks every pixel, and at sixty frames a second that is nine million
   * calls. Working it out from the register bits each time -- and handing back
   * a fresh object for the answer -- put an allocation in the middle of the
   * tightest loop in the simulator, which showed up as eight percent of the
   * whole frame in the profiler.
   *
   * So the transformation is solved once per orientation and cached, and the
   * inner loop is four additions. Nothing about the mapping changes while MADCTL
   * does, so the cache is invalidated exactly when the orientation does.
   */
  /** Sign and offset for the visible x, into the RAM's page axis. */
  private xStep = 1;
  private xBase = 0;
  /** Sign and offset for the visible y, into the RAM's column axis. */
  private yStep = 1;
  private yBase = 0;
  private mappedMadctl = -1;

  /**
   * Re-derives the coordinate mapping if the orientation has changed.
   *
   * Called by every reader and writer of a pixel. The guard is a single integer
   * compare against the register value, which is the cheapest test that can be
   * correct -- anything looser would leave a turned panel drawing as if it
   * were upright, which is the bug this caching exists to avoid repeating.
   */
  private ensureMapped(): void {
    if (this.mappedMadctl === this.madctl) return;
    this.mappedMadctl = this.madctl;

    const swap = (this.madctl & MADCTL_MV) !== 0;
    const mirrorX = (this.madctl & MADCTL_MX) !== 0;
    const mirrorY = (this.madctl & MADCTL_MY) !== 0;

    /*
     * Without a swap the two visible axes are the two RAM axes. With one they
     * exchange places: visible x walks the RAM's pages and visible y walks its
     * columns. Each mirror then applies to the axis it lands on, so a mirrored
     * x is bounded by the RAM's *page* count and a mirrored y by its column
     * count -- which is the one genuinely confusing thing about a swap, and
     * why the two are worked out separately rather than shared.
     */
    const ramWidthForX = swap ? this.ramHeight : this.ramWidth;
    this.xStep = mirrorX ? -1 : 1;
    this.xBase = mirrorX ? ramWidthForX - 1 : 0;

    const ramHeightForY = swap ? this.ramWidth : this.ramHeight;
    this.yStep = mirrorY ? -1 : 1;
    this.yBase = mirrorY ? ramHeightForY - 1 : 0;
  }

  /**
   * The byte offset of a visible pixel in the framebuffer.
   *
   * Returns -1 when the point falls outside the panel, so a caller can skip it
   * without a second bounds check of its own.
   */
  private ramOffset(x: number, y: number): number {
    this.ensureMapped();
    const swap = (this.madctl & MADCTL_MV) !== 0;
    // Column comes from whichever visible axis the RAM treats as its column.
    const column = swap ? y * this.yStep + this.yBase : x * this.xStep + this.xBase;
    const page = swap ? x * this.xStep + this.xBase : y * this.yStep + this.yBase;
    if (column < 0 || column >= this.ramWidth || page < 0 || page >= this.ramHeight) {
      return -1;
    }
    return (page * this.ramWidth + column) * 2;
  }

  /**
   * RGB565 value of a pixel, or 0 when out of range.
   *
   * In the panel's own coordinate space, so a caller asking for (0, 0) gets
   * the top left of whatever is currently on screen rather than the top left of
   * the RAM underneath it.
   */
  pixelAt(x: number, y: number): number {
    const offset = this.ramOffset(x, y);
    if (offset < 0) return 0;
    // RGB565 arrives high byte first, so the first byte stored is the high one.
    return (this.framebuffer[offset] << 8) | this.framebuffer[offset + 1];
  }

  /**
   * The whole visible surface expanded to 0xAARRGGBB, for the UI's canvas.
   *
   * Already in reading order, so the canvas does not have to know the panel is
   * turned: it is handed an upright image of whatever a user is looking at,
   * which is the only way the renderer stays a renderer.
   */
  toRgba(): Uint8ClampedArray {
    const width = this.width;
    const height = this.height;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const colour = this.pixelAt(x, y);
        const i = (y * width + x) * 4;
        const red = (colour >> 11) & 0x1f;
        const green = (colour >> 5) & 0x3f;
        const blue = colour & 0x1f;
        // Expand 5/6/5 bits to 8 by replicating the high bits.
        pixels[i] = (red << 3) | (red >> 2);
        pixels[i + 1] = (green << 2) | (green >> 4);
        pixels[i + 2] = (blue << 3) | (blue >> 2);
        pixels[i + 3] = 0xff;
      }
    }
    return pixels;
  }

  /**
   * Copies a block of RGB565 straight into the framebuffer.
   *
   * The streaming commands can only write what they are told to write, one
   * byte at a time, which is the right shape for a shape the program is
   * calculating and the wrong one for a picture it was handed. A blit is how a
   * display takes the second kind: the caller hands over a finished block and
   * the panel shows it, with the edges clipped rather than wrapped -- a screen
   * edge is where a tile gets cut, and cutting it is not the same as rolling
   * it round to the other side.
   *
   * Clipping happens in the panel's own space, so turning the panel turns the
   * picture with it and a tile blitted at (0,0) still lands at the top left of
   * the glass.
   */
  blit(x: number, y: number, width: number, height: number, rgb565: Uint16Array): void {
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const offset = this.ramOffset(x + col, y + row);
        // Off the panel is clipped, not wrapped: a screen edge is where a tile
        // gets cut, and cutting it is not the same as rolling it round.
        if (offset < 0) continue;
        const colour = rgb565[row * width + col];
        this.framebuffer[offset] = colour >> 8;
        this.framebuffer[offset + 1] = colour & 0xff;
      }
    }
  }

  /**
   * Turns the panel, the way `tft.setRotation()` does.
   *
   * Goes through the same register the sketch writes over SPI rather than
   * around it, so a program that uses this call and one that writes MADCTL
   * itself land in exactly the same state. The distinction is worth keeping:
   * the register is what the panel obeys, and this is only a way of setting it.
   */
  setRotation(rotation: PanelRotation): PanelRotation {
    this.madctl = ROTATION_MADCTL[rotation] ?? ROTATION_MADCTL[0];
    return this.rotation;
  }

  /**
   * Fills a rectangle with one colour, as `fillRect()` does.
   *
   * RGB565 rather than three 0-255 channels, because that is what the panel
   * holds and a sketch that mixes its own colours would rather be handed the
   * same 16-bit value the hardware would have been given.
   */
  fill(x: number, y: number, width: number, height: number, colour: number): void {
    const solid = new Uint16Array(width * height).fill(colour & 0xffff);
    this.blit(x, y, width, height, solid);
  }

  /**
   * Draws text at a position in the panel's own 5x7 font.
   *
   * Column bytes rather than row bits, so each glyph is five vertical strokes
   * of seven pixels: the byte holds a column, and its bits are the seven rows
   * from the top down. That is the font the character LCD already uses, which
   * is the point — one glyph table for every display in the simulator, so a
   * letter looks the same wherever it lands.
   *
   * Text is measured rather than clipped silently, so a caller can place a line
   * it knows the width of. A string that runs off the edge is cut, not wrapped.
   */
  print(text: string, x: number, y: number, colour: number): void {
    let cursor = x;
    for (const character of text) {
      if (cursor >= this.width) break;
      const glyph = glyphFor(character);
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        const bits = glyph[col];
        for (let row = 0; row < GLYPH_HEIGHT; row++) {
          if (((bits >> row) & 1) === 0) continue;
          this.setVisible(cursor + col, y + row, colour);
        }
      }
      cursor += GLYPH_ADVANCE;
    }
  }

  /** The width in pixels a string will occupy, gaps included. */
  textWidth(text: string): number {
    return measureText(text);
  }

  /** The font's cap height in pixels. */
  textHeight(): number {
    return GLYPH_HEIGHT;
  }

  /** Stores one pixel in the panel's own coordinate space. */
  private setVisible(x: number, y: number, colour: number): void {
    const offset = this.ramOffset(x, y);
    if (offset < 0) return;
    this.framebuffer[offset] = colour >> 8;
    this.framebuffer[offset + 1] = colour & 0xff;
  }

  /** Wipes the framebuffer, as the TFT_eSPI clear() does. */
  clear(): void {
    this.framebuffer.fill(0);
  }

  private executeCommand(command: number): void {
    // Single-byte commands, handled before the argument machinery.
    if (command === 0x01) {
      this.reset();
      return;
    }
    if (command === 0x11) {
      this.streaming = false;
      return; // sleep out
    }
    if (command === 0x29) {
      this.displayOn = true;
      return;
    }
    if (command === 0x28) {
      this.displayOn = false;
      return;
    }

    if (STREAM_COMMANDS.has(command)) {
      this.cursorColumn = this.columnStart;
      this.cursorPage = this.pageStart;
      this.expectHighByte = true;
      this.streaming = true;
      return;
    }

    const arguments_ = ARGUMENT_COUNTS[command];
    if (arguments_ === undefined) return; // unknown command: ignored, as the chip does

    this.streaming = false;
    this.commandInFlight = command;
    this.argumentIndex = 0;
    this.expecting = arguments_;
  }

  /**
   * Applies one parameter, already assembled by the caller.
   *
   * `value` is the full parameter: 16-bit for the address commands, a single
   * byte otherwise. `index` is which parameter this is, which is what tells a
   * high/low pair apart from the start and end of a range.
   */
  private applyArgument(value: number, index: number): void {
    switch (this.commandInFlight) {
      case 0x2a:
        if (index === 1) this.columnStart = Math.min(value, this.ramWidth - 1);
        else if (index === 3) this.columnEnd = Math.max(0, Math.min(value, this.ramWidth - 1));
        return;
      case 0x2b:
        if (index === 1) this.pageStart = Math.min(value, this.ramHeight - 1);
        else if (index === 3) this.pageEnd = Math.max(0, Math.min(value, this.ramHeight - 1));
        return;
      case MADCTL:
        if (index === 0) this.madctl = value & (MADCTL_MX | MADCTL_MY | MADCTL_MV);
        return;
      default:
        // The rest affect drive, not what is stored on screen.
        return;
    }
  }

  private reset(): void {
    this.displayOn = false;
    this.streaming = false;
    this.expecting = 0;
    this.columnStart = 0;
    this.columnEnd = this.ramWidth - 1;
    this.pageStart = 0;
    this.pageEnd = this.ramHeight - 1;
    this.cursorColumn = 0;
    this.cursorPage = 0;
    this.expectHighByte = true;
    // A software reset returns the panel to its datasheet state, orientation
    // included. Leaving MADCTL set would make the panel come back turned.
    this.madctl = 0;
  }

  /**
   * Writes one byte of the RGB565 pixel stream.
   *
   * The cursor walks the active window and wraps at its edges, so a stream
   * longer than the window rolls over rather than running off the buffer.
   */
  private writePixelByte(byte: number): void {
    if (this.cursorColumn < 0 || this.cursorColumn >= this.ramWidth) return;
    if (this.cursorPage < 0 || this.cursorPage >= this.ramHeight) return;
    const index = (this.cursorPage * this.ramWidth + this.cursorColumn) * 2 + (this.expectHighByte ? 0 : 1);
    this.framebuffer[index] = byte;
    if (this.expectHighByte) {
      this.expectHighByte = false;
      return;
    }

    this.expectHighByte = true;
    this.cursorColumn++;
    if (this.cursorColumn > this.columnEnd) {
      this.cursorColumn = this.columnStart;
      this.cursorPage++;
      if (this.cursorPage > this.pageEnd) this.cursorPage = this.pageStart;
    }
  }
}