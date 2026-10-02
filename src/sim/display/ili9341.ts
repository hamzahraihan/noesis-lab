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

export const ILI9341_WIDTH = 320;
export const ILI9341_HEIGHT = 240;

const FRAMEBUFFER_BYTES = ILI9341_WIDTH * ILI9341_HEIGHT * 2;

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
  private readonly framebuffer = new Uint8Array(FRAMEBUFFER_BYTES);

  private displayOn = false;
  private inverted = false;
  private swappedAxes = false;

  private columnStart = 0;
  private columnEnd = ILI9341_WIDTH - 1;
  private pageStart = 0;
  private pageEnd = ILI9341_HEIGHT - 1;

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

  get isMirrored(): boolean {
    return this.swappedAxes;
  }

  get isInverted(): boolean {
    return this.inverted;
  }

  /** RGB565 value of a pixel, or 0 when out of range. */
  pixelAt(x: number, y: number): number {
    if (x < 0 || x >= ILI9341_WIDTH || y < 0 || y >= ILI9341_HEIGHT) return 0;
    const index = (y * ILI9341_WIDTH + x) * 2;
    // RGB565 arrives high byte first, so the first byte stored is the high one.
    return (this.framebuffer[index] << 8) | this.framebuffer[index + 1];
  }

  /** The whole buffer expanded to 0xAARRGGBB, for the UI's canvas. */
  toRgba(): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(ILI9341_WIDTH * ILI9341_HEIGHT * 4);
    for (let i = 0; i < ILI9341_WIDTH * ILI9341_HEIGHT; i++) {
      const colour = (this.framebuffer[i * 2] << 8) | this.framebuffer[i * 2 + 1];
      const red = (colour >> 11) & 0x1f;
      const green = (colour >> 5) & 0x3f;
      const blue = colour & 0x1f;
      // Expand 5/6/5 bits to 8 by replicating the high bits.
      pixels[i * 4] = (red << 3) | (red >> 2);
      pixels[i * 4 + 1] = (green << 2) | (green >> 4);
      pixels[i * 4 + 2] = (blue << 3) | (blue >> 2);
      pixels[i * 4 + 3] = 0xff;
    }
    return pixels;
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
    if (command === 0x21) {
      this.inverted = true;
      return;
    }
    if (command === 0x20) {
      this.inverted = false;
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
        if (index === 1) this.columnStart = Math.min(value, ILI9341_WIDTH - 1);
        else if (index === 3) this.columnEnd = Math.max(0, Math.min(value, ILI9341_WIDTH - 1));
        return;
      case 0x2b:
        if (index === 1) this.pageStart = Math.min(value, ILI9341_HEIGHT - 1);
        else if (index === 3) this.pageEnd = Math.max(0, Math.min(value, ILI9341_HEIGHT - 1));
        return;
      case 0x36:
        if (index === 0) this.swappedAxes = (value & 0x80) !== 0;
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
    this.columnEnd = ILI9341_WIDTH - 1;
    this.pageStart = 0;
    this.pageEnd = ILI9341_HEIGHT - 1;
    this.cursorColumn = 0;
    this.cursorPage = 0;
    this.expectHighByte = true;
    // A software reset returns the panel to its datasheet state, orientation
    // included. Leaving MADCTL set would make the panel come back mirrored.
    this.swappedAxes = false;
    this.inverted = false;
  }

  /**
   * Writes one byte of the RGB565 pixel stream.
   *
   * The cursor walks the active window and wraps at its edges, so a stream
   * longer than the window rolls over rather than running off the buffer.
   */
  private writePixelByte(byte: number): void {
    const index = (this.cursorPage * ILI9341_WIDTH + this.cursorColumn) * 2 + (this.expectHighByte ? 0 : 1);
    if (index >= 0 && index < FRAMEBUFFER_BYTES) this.framebuffer[index] = byte;
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