/**
 * SSD1306 OLED controller: the 128x64 module sold as a 4-pin I2C breakout.
 *
 * The model speaks the real datasheet protocol rather than a friendly API,
 * because that protocol *is* the lesson: a sketch that forgets the addressing
 * commands, or writes to the wrong control byte, produces a blank or garbled
 * screen exactly as it would on the bench.
 *
 * Commands implemented are the ones sketches actually send. Anything else is
 * parsed for length and ignored rather than rejected, because a real controller
 * silently ignores what it does not recognise -- which is exactly how a wrong
 * command turns into a blank panel instead of a visible error.
 */
import { GLYPH_ADVANCE, GLYPH_HEIGHT, GLYPH_SPACING, GLYPH_WIDTH, glyphFor } from './font5x7';

export const SSD1306_WIDTH = 128;
export const SSD1306_HEIGHT = 64;
export const SSD1306_PAGES = SSD1306_HEIGHT / 8;

const FRAMEBUFFER_BYTES = SSD1306_WIDTH * SSD1306_PAGES;


const ADDRESSING_VERTICAL = 0x01;
const ADDRESSING_PAGE = 0x02;

/**
 * How many argument bytes each multi-byte command consumes.
 * Getting a length wrong is destructive in a way that is hard to see: the
 * command is treated as single-byte, every later byte is swallowed as an
 * argument, and the addressing mode silently changes -- which fills the panel
 * with garbage rather than raising anything.
 */
const ARGUMENT_COUNTS: Readonly<Record<number, number>> = {
  0x20: 1, // memory addressing mode
  0x21: 2, // column address range
  0x22: 2, // page address range
  0xad: 1, // DC-DC control
  0x81: 1, // contrast
  0x8d: 1, // charge pump setting
  0xa8: 1, // multiplex ratio
  0xc8: 1, // COM output scan direction
  0xd3: 1, // display offset
  0xd5: 1, // display clock divide
  0xd8: 1, // common pads
  0xd9: 1, // pre-charge period
  0xda: 1, // COM pins deselect
  0xdb: 1, // VCOM deselect
};

export class Ssd1306 {
  readonly address: number;

  private readonly framebuffer = new Uint8Array(FRAMEBUFFER_BYTES);

  private displayOn = false;
  private contrast = 0x7f;
  private segmentRemap = false;
  private addressingMode = ADDRESSING_PAGE;
  private columnStart = 0;
  private columnEnd = SSD1306_WIDTH - 1;
  private pageStart = 0;
  private pageEnd = SSD1306_PAGES - 1;

  /** Where the next data byte lands. */
  private column = 0;
  private page = 0;

  /** True once a control byte has selected the data stream. */
  private dataStream = false;
  /** Argument bytes still expected for the command in flight. */
  private expecting = 0;
  private commandInFlight = 0;
  private argumentIndex = 0;

  constructor(address = 0x3c) {
    this.address = address & 0x7f;
  }

  /**
   * Accepts one byte of an I2C payload. Returns false when the address is not
   * ours, which is what makes an unwired display fail quietly.
   *
   * `isControlPosition` comes from the bus rather than being inferred from the
   * byte's value. The datasheet is explicit that the first byte after the
   * address is always a control byte, and inferring it would misread a genuine
   * `0x00` argument -- such as the column start in `set column address` -- as
   * a stream selector and quietly desynchronise every command after it.
   */
  receive(address: number, byte: number, isControlPosition = false): boolean {
    if ((address & 0x7f) !== this.address) return false;

    if (isControlPosition) {
      this.dataStream = (byte & 0x40) !== 0;
      return true;
    }

    if (this.dataStream) this.writeData(byte);
    else this.executeCommand(byte);
    return true;
  }

  isLit(x: number, y: number): boolean {
    if (x < 0 || x >= SSD1306_WIDTH || y < 0 || y >= SSD1306_HEIGHT) return false;
    return (this.framebuffer[(y >> 3) * SSD1306_WIDTH + x] & (1 << (y & 7))) !== 0;
  }

  get lit(): boolean {
    return this.displayOn;
  }

  get brightness(): number {
    return this.contrast / 0xff;
  }

  /** True when segment remapping mirrors the image left-to-right. */
  get mirrored(): boolean {
    return this.segmentRemap;
  }


  /**
   * Sets a single pixel directly, bypassing the addressing pointer.
   *
   * This is what a graphics library does between transfers; it exists so text
   * and shapes can be composed without every helper re-issuing a hundred
   * addressing commands.
   */
  setPixel(x: number, y: number, on: boolean): void {
    if (x < 0 || x >= SSD1306_WIDTH || y < 0 || y >= SSD1306_HEIGHT) return;
    const index = (y >> 3) * SSD1306_WIDTH + x;
    const bit = 1 << (y & 7);
    if (on) this.framebuffer[index] |= bit;
    else this.framebuffer[index] &= ~bit;
  }

  /**
   * Draws a 5x7 string starting at (x, y).
   *
   * Returns the x coordinate just past the text, so callers can chain calls
   * without measuring first. Glyph columns are sent to the panel bottom-up,
   * which is the order the framebuffer stores them in.
   */
  drawText(text: string, x: number, y: number): number {
    let cursor = x;
    for (const character of text) {
      const glyph = glyphFor(character);
      for (let column = 0; column < GLYPH_WIDTH; column++) {
        const bits = glyph[column];
        for (let row = 0; row < GLYPH_HEIGHT; row++) {
          if (bits & (1 << row)) this.setPixel(cursor + column, y + row, true);
        }
      }
      cursor += GLYPH_ADVANCE;
    }
    return cursor - GLYPH_SPACING;
  }
  /** Packed one byte per pixel, for the UI to render. */
  snapshot(): Uint8Array {
    const pixels = new Uint8Array(SSD1306_WIDTH * SSD1306_HEIGHT);
    for (let y = 0; y < SSD1306_HEIGHT; y++) {
      for (let x = 0; x < SSD1306_WIDTH; x++) {
        pixels[y * SSD1306_WIDTH + x] = this.isLit(x, y) ? 1 : 0;
      }
    }
    return pixels;
  }

  /** Wipes the framebuffer, as the Adafruit library's clear() does. */
  clear(): void {
    this.framebuffer.fill(0);
  }

  private executeCommand(byte: number): void {
    if (this.expecting > 0) {
      this.applyArgument(byte);
      this.argumentIndex++;
      this.expecting--;
      return;
    }

    // Single-byte commands, in datasheet order.
    if (byte === 0xae) { this.displayOn = false; return; }
    if (byte === 0xaf) { this.displayOn = true; return; }
    if (byte === 0xa0) { this.segmentRemap = false; return; }
    if (byte === 0xa1) { this.segmentRemap = true; return; }
    if (byte >= 0xb0 && byte <= 0xb7) { this.page = byte & 0x07; return; }
    if (byte <= 0x0f) { this.column = (this.column & 0xf0) | byte; return; }
    if (byte >= 0x10 && byte <= 0x1f) { this.column = (this.column & 0x0f) | ((byte & 0x0f) << 4); return; }
    if (byte >= 0x40 && byte <= 0x7f) { return; } // display start line

    // 0x15 and 0x16 carry their value in the low nibble, not as arguments.
    if (byte === 0x15) { this.columnStart = byte & 0x0f; this.column = this.columnStart; return; }
    if (byte === 0x16) { this.pageStart = byte & 0x0f; this.page = this.pageStart; return; }

    const arguments_ = ARGUMENT_COUNTS[byte];
    if (arguments_ === undefined) return; // unknown command: ignore, as the chip does

    this.commandInFlight = byte;
    this.argumentIndex = 0;
    this.expecting = arguments_;
  }

  private applyArgument(value: number): void {
    switch (this.commandInFlight) {
      case 0x20:
        this.addressingMode = value & 0x03;
        return;
      case 0x21:
        if (this.argumentIndex === 0) this.columnStart = value & 0x7f;
        else this.columnEnd = value & 0x7f;
        return;
      case 0x22:
        if (this.argumentIndex === 0) this.pageStart = value & 0x0f;
        else this.pageEnd = value & 0x0f;
        return;
      case 0x81:
        this.contrast = value & 0xff;
        return;
      default:
        // The remaining commands affect drive, not what is stored on screen.
        return;
    }
  }

  private writeData(byte: number): void {
    const index = this.page * SSD1306_WIDTH + this.column;
    if (index >= 0 && index < FRAMEBUFFER_BYTES) this.framebuffer[index] = byte;
    this.advanceAddressing();
  }

  /**
   * Advances the write pointer according to the active addressing mode.
   *
   * The three modes differ only in where the wrap happens, and getting that
   * wrong produces a diagonal smear across the panel that looks like a dead
   * segment rather than an addressing error.
   */
  private advanceAddressing(): void {
    if (this.addressingMode === ADDRESSING_VERTICAL) {
      // Walk down a column, then to the next column.
      this.page++;
      if (this.page <= this.pageEnd) return;
      this.page = this.pageStart;
      this.column++;
      if (this.column <= this.columnEnd) return;
      this.column = this.columnStart;
      return;
    }

    // Horizontal and page modes both step the column.
    this.column++;
    if (this.column <= this.columnEnd) return;

    this.column = this.columnStart;
    if (this.addressingMode === ADDRESSING_PAGE) return;

    // Horizontal wraps down to the next page.
    this.page++;
    if (this.page > this.pageEnd) this.page = this.pageStart;
  }
}