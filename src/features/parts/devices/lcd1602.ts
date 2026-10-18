/**
 * HD44780 character LCD: the controller behind every 16x2 and 20x4 glass.
 *
 * The model speaks the instruction set rather than a friendly API, because that
 * instruction set *is* the lesson: the bytes a sketch puts on D4-D7 decide what
 * the glass shows, and an address the sketch gets wrong puts its text in the
 * wrong place instead of raising anything. Instructions the model does not
 * recognise are dropped, exactly as the controller drops them, which is how a
 * mistyped command turns into a blank panel rather than a visible error.
 *
 * One `Lcd1602` serves both sizes. A 20x4 is the same glass with more of it:
 * the same controller, the same sixteen-pin header, and a different answer to
 * where a row lives in DDRAM.
 */

import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphFor } from '../display/font5x7';

/** Characters across the common glass. */
export const LCD_1602_COLUMNS = 16;
/** Character rows on it. */
export const LCD_1602_ROWS = 2;
/** Characters across a 20x4. */
export const LCD_2004_COLUMNS = 20;
/** Character rows on it. */
export const LCD_2004_ROWS = 4;

/** Dots across one character cell. */
export const LCD_CELL_WIDTH = GLYPH_WIDTH;

/**
 * Dots down one character cell.
 *
 * The HD44780's cell is 5x8 while the shared font is 5x7, and the extra row is
 * the reason the two cannot simply be copied across: the controller keeps the
 * cursor underline in the bottom row, and the A00 ROM keeps the descenders of
 * g, j, p, q and y there. A ROM glyph therefore occupies the top seven rows and
 * leaves the eighth dark, so an underline cursor sits under a character without
 * covering any of it. A glyph loaded into CGRAM supplies all eight rows, and the
 * cursor is drawn over the eighth because that is what the controller does.
 */
export const LCD_CELL_HEIGHT = GLYPH_HEIGHT + 1;

/** Custom glyph slots the controller has. */
export const CGRAM_SLOTS = 8;

/** Printable ASCII the shared font covers, which is the range it was drawn for. */
const ROM_FIRST = 0x20;
const ROM_LAST = 0x5f;

/**
 * Instruction opcodes, HD44780U datasheet instruction table: an instruction is
 * its own value with the flags below folded into the rest of the byte, and a
 * data write is whatever the byte happens to be.
 */
const CLEAR_DISPLAY = 0x01;
const RETURN_HOME = 0x02;
const ENTRY_MODE = 0x04;
const DISPLAY_CONTROL = 0x08;
const CURSOR_SHIFT = 0x10;
const FUNCTION_SET = 0x20;
const SET_CGRAM_ADDRESS = 0x40;
const SET_DDRAM_ADDRESS = 0x80;

/** Entry mode set: I/D takes the address on after a write, S scrolls to follow it. */
const INCREMENT = 0x02;
const AUTOSCROLL = 0x01;

/** Display control: D lights the glass, C shows the cursor, B makes it blink. */
const DISPLAY_ON = 0x04;
const CURSOR_ON = 0x02;
const BLINK_ON = 0x01;

/** Cursor or display shift: S/C picks which one moves, R/L the direction. */
const SHIFT_DISPLAY = 0x08;
const SHIFT_RIGHT = 0x04;

/**
 * Where each row of the glass starts in DDRAM, HD44780U datasheet DDRAM address
 * map. The four-line case is not contiguous, and that is not a quirk invented
 * here: on a four-line display the third row begins at 0x14, straight after the
 * first, and the fourth at 0x54. Addressing four rows as one long block writes
 * into the gap between the second and third and the text never appears, which is
 * exactly what happens on the bench.
 */
const TWO_LINE_ROW_BASES: readonly number[] = [0x00, 0x40];
const FOUR_LINE_ROW_BASES: readonly number[] = [0x00, 0x40, 0x14, 0x54];

/** What a cleared cell holds: a blank, which the font already has a glyph for. */
const BLANK_CHARACTER = 0x20;

/**
 * The shared font, laid out the way the glass shows it: one eight-byte cell per
 * code, bit N of a row byte the Nth dot from the left.
 *
 * Transposed once when the module loads rather than per draw, because a redraw
 * walks every cell on the glass and 64 glyphs of answer that never changes is
 * work worth doing up front.
 */
const ROM_CELLS = buildRomCells();

function buildRomCells(): Uint8Array {
  const cells = new Uint8Array((ROM_LAST - ROM_FIRST + 1) * LCD_CELL_HEIGHT);
  for (let code = ROM_FIRST; code <= ROM_LAST; code++) {
    const columns = glyphFor(String.fromCharCode(code));
    const offset = (code - ROM_FIRST) * LCD_CELL_HEIGHT;
    for (let column = 0; column < LCD_CELL_WIDTH; column++) {
      const bits = columns[column];
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        if (bits & (1 << row)) cells[offset + row] |= 1 << column;
      }
    }
  }
  return cells;
}

/**
 * Where a character code sits in the shared font.
 *
 * Lowercase folds to uppercase, as the shared font does, so `print("ok")` puts
 * `OK` on the glass -- the one place where reusing that font is visible, since
 * the A00 ROM the real glass carries does have lowercase. A code the font has no
 * glyph for reads as a space rather than as noise, which is what the font itself
 * does with anything outside its range.
 */
function romIndex(code: number): number {
  const folded = code >= 0x61 && code <= 0x7a ? code - 0x20 : code;
  return folded >= ROM_FIRST && folded <= ROM_LAST ? folded - ROM_FIRST : 0;
}

/**
 * Where the cursor is on the glass, in screen coordinates.
 *
 * Held as one object and updated in place: the bench asks for it every redraw,
 * and a fresh object each time would be a small allocation per frame for state
 * that only ever changes when a command arrives. `column` is -1 while the address
 * counter points somewhere the glass has no memory, and `visible` is false while
 * the display is off, because a real controller draws neither then.
 */
export interface LcdCursor {
  row: number;
  column: number;
  visible: boolean;
  /** The B bit: the renderer owns the blink, the controller only asks for it. */
  blink: boolean;
}

export class Lcd1602 {
  readonly columns: number;
  readonly rows: number;

  /** Character codes as the glass stores them, row-major. */
  private readonly ddram: Uint8Array;

  /** The high nibble waiting for its partner, and how many have arrived. */
  private pending = 0;
  private nibblesSeen = 0;

  /** First DDRAM address of each row, from the datasheet's address map. */
  private readonly rowBases: readonly number[];

  /** Where the address counter points: 0x00-0x7F, and 0x00-0x3F in CGRAM. */
  private address = 0;
  /** Which memory the counter is pointing into, set by the last address command. */
  private inCgram = false;
  /** How far the display has been scrolled across the rows, in columns. */
  private viewShift = 0;

  /**
   * CGRAM as the controller keeps it: eight rows a slot, bit N the Nth dot from
   * the left.
   *
   * That is the order a sketch writes a glyph in, so a custom character is
   * stored exactly as it arrived. The ROM font is the one that has to be turned
   * about, because the shared font holds columns where the glass wants rows.
   */
  private readonly cgramRows = new Uint8Array(CGRAM_SLOTS * LCD_CELL_HEIGHT);

  /** D of the display control instruction. Off at power-up, which is the point. */
  private displayOnBit = false;
  /** C of the display control instruction. */
  private cursorOnBit = false;
  /** Whether the module's backlight is lit, which no instruction decides. */
  private backlightBit = true;
  /** I/D: whether a write moves the counter on, or back. */
  private incrementing = true;
  /** S: whether a write scrolls the glass to keep the cursor in view. */
  private scrolling = false;

  readonly cursor: LcdCursor = { row: 0, column: 0, visible: false, blink: false };

  constructor(columns: number, rows: number) {
    this.columns = columns;
    this.rows = rows;
    // Nothing has been written yet, and the panel is dark anyway until the first
    // display control instruction, so a blank is the honest reading of DDRAM.
    this.ddram = new Uint8Array(columns * rows).fill(BLANK_CHARACTER);
    this.rowBases = rows > 2 ? FOUR_LINE_ROW_BASES : TWO_LINE_ROW_BASES;
  }

  /**
   * Hands the controller one byte of its own protocol.
   *
   * `rs` is the level on the RS line: low for a command, high for data. The
   * host owns the E pulse and the 4-bit assembly, so what arrives here is always
   * a whole byte -- which is also what a sketch on the other side is sending,
   * since the instruction set has no half-byte instructions.
   */
  /**
   * Hands the controller one byte of its own protocol.
   *
   * Four bits at a time on the wire, so the controller reassembles the two
   * halves before anything above this line ever sees a byte -- which is why
   * the panel needs five data pins rather than eight.
   */
  receive(rs: boolean, value: number): void {
    /*
     * Four bits at a time, and the controller shifts the second half in beside
     * the first. Nothing above this line ever sees more than a nibble, which is
     * the whole reason a character LCD needs five data pins rather than eight.
     */
    /*
     * The high nibble arrives first and waits in the top half; the low one
     * replaces what is there rather than joining it, because OR-ing it in would
     * leave the high half where it was and every byte would read as the high
     * nibble twice over.
     */
    if (this.nibblesSeen === 0) this.pending = (value & 0x0f) << 4;
    else this.pending = (this.pending & 0xf0) | (value & 0x0f);
    if (++this.nibblesSeen < 2) return;

    const byte = this.pending & 0xff;
    this.pending = 0;
    this.nibblesSeen = 0;
    /*
     * A command mid-stream can reset the controller's own nibble alignment --
     * a function set does exactly that -- so the pair has to be re-formed from
     * whatever follows it, or every byte after the first is shifted by a half.
     */
    if (!rs && (byte & FUNCTION_SET) !== 0) this.pending = 0;
    if (rs) this.writeData(byte);
    else this.executeCommand(byte);
  }

  /**
   * The characters in display RAM, row by row.
   *
   * This is what the artwork draws: a character LCD's element takes the panel's
   * text as a string and renders the glyphs itself, exactly as the glass does,
   * so the characters have to come back out as well as the dots.
   */
  text(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.rows; row++) {
      let line = '';
      for (let column = 0; column < this.columns; column++) {
        line += String.fromCharCode(this.ddram[row * this.columns + column]);
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /**
   * The DDRAM address a row's first character lives at.
   *
   * A 16x2 has a gap between its rows at 0x10, and a 20x4 has one between
   * every pair -- which is why the second half of a 20x4 sits *above* the first
   * rather than below it. The glass knows this; nothing else should have to.
   */
  rowBase(row: number): number {
    return this.rowBases[Math.min(Math.max(0, Math.floor(row)), this.rowBases.length - 1)];
  }

  /** How many characters the panel has, across and down. */
  get shape(): { readonly columns: number; readonly rows: number } {
    return { columns: this.columns, rows: this.rows };
  }

  /** True while the display control instruction has the glass lit. */
  get lit(): boolean {
    return this.displayOnBit;
  }

  get backlightOn(): boolean {
    return this.backlightBit;
  }

  /**
   * Lights or dims the module's backlight.
   *
   * The backlight is a pair of pins on the module, not a command: the library's
   * `backlight()` holds the module's transistor on, and the host is the only
   * thing that knows whether those pins ended up driven. The glass is a separate
   * question, which is why a panel with no backlight still shows its characters.
   */
  setBacklight(on: boolean): void {
    this.backlightBit = on;
  }

  /**
   * True when the dot at (x, y) is dark-on-light, x and y across the whole glass.
   *
   * The dot grid is what the glass is made of -- five by eight to a cell -- so
   * this is the whole picture, and the renderer needs nothing else to draw it.
   * The cursor is not part of it: the controller adds the underline to whatever
   * the cell already holds, and a renderer that blinks has to own that anyway.
   */
  isLit(x: number, y: number): boolean {
    const dotRow = Math.floor(y / LCD_CELL_HEIGHT);
    const column = Math.floor(x / LCD_CELL_WIDTH);
    const cell = this.screenCell(dotRow, column);
    if (cell < 0) return false;
    const bits = this.cellRow(cell, y - dotRow * LCD_CELL_HEIGHT);
    return (bits & (1 << (x - column * LCD_CELL_WIDTH))) !== 0;
  }

  /**
   * The bitmap `createChar` left in a CGRAM slot: eight rows, bit N the Nth dot
   * from the left, which is the order a sketch's own glyph is written in.
   *
   * Only the low five bits of each row come back, because CGRAM is five dots
   * wide and the controller has nowhere to put the rest.
   */
  customGlyph(slot: number): readonly number[] {
    if (slot < 0 || slot >= CGRAM_SLOTS) return [];
    const offset = slot * LCD_CELL_HEIGHT;
    return Array.from(this.cgramRows.subarray(offset, offset + LCD_CELL_HEIGHT));
  }

  private executeCommand(byte: number): void {
    /*
     * Every instruction is recognised by its top bits, so the tests run from the
     * top down: a DDRAM address may well have bit 6 or bit 5 set -- 0xA8 sets
     * both -- and reading it as anything but an address would lose the write
     * without any sign that it had been lost.
     */
    if (byte & SET_DDRAM_ADDRESS) {
      this.address = byte & 0x7f;
      this.inCgram = false;
      this.syncCursor();
      return;
    }
    if (byte & SET_CGRAM_ADDRESS) {
      this.address = byte & 0x3f;
      this.inCgram = true;
      this.syncCursor();
      return;
    }
    if (byte & FUNCTION_SET) {
      /*
       * Function set, 0x20-0x3F. Its flags pick the interface width and the line
       * count, and neither is the model's to decide: the width is the host's,
       * since only the host knows whether a byte arrived as one transfer or two,
       * and the line count is the glass the part definition named. Reading it as
       * anything else would be wrong, so the instruction is taken and dropped.
       */
      return;
    }
    if (byte === CLEAR_DISPLAY) {
      this.ddram.fill(BLANK_CHARACTER);
      this.address = 0;
      this.inCgram = false;
      this.syncCursor();
      return;
    }
    if (byte === RETURN_HOME) {
      this.address = 0;
      this.inCgram = false;
      this.syncCursor();
      return;
    }

    switch (byte & 0xf8) {
      case DISPLAY_CONTROL:
        this.displayOnBit = (byte & DISPLAY_ON) !== 0;
        this.cursorOnBit = (byte & CURSOR_ON) !== 0;
        this.cursor.blink = (byte & BLINK_ON) !== 0;
        this.syncCursor();
        return;
      case ENTRY_MODE:
        this.incrementing = (byte & INCREMENT) !== 0;
        this.scrolling = (byte & AUTOSCROLL) !== 0;
        return;
      case CURSOR_SHIFT: {
        const right = (byte & SHIFT_RIGHT) !== 0;
        if (byte & SHIFT_DISPLAY) {
          /*
           * The display moves and the counter does not, which is what lets a
           * sketch scroll text without disturbing where the next write lands.
           * The window slides across the row, so a column shifted past the edge
           * shows blank: the characters really are gone, not hidden somewhere.
           */
          this.viewShift += right ? -1 : 1;
        } else {
          this.address = (this.address + (right ? 1 : -1)) & 0x7f;
        }
        this.syncCursor();
        return;
      }
      default:
        // 0x00 and 0x03: the two encodings the table leaves as no operation.
        return;
    }
  }

  private writeData(value: number): void {
    if (this.inCgram) {
      /*
       * A slot is eight addresses and each one holds a row of five dots, which
       * is the same order a sketch writes its glyph in -- which is why the
       * library can hand eight bytes over and get the glyph it drew. Only the
       * five low bits survive: a sixth and seventh dot have nowhere to go, and
       * the controller keeps what it was given rather than rounding.
       */
      this.cgramRows[(this.address >> 3) * LCD_CELL_HEIGHT + (this.address & 0x07)] = value & 0x1f;
      this.address = (this.address + 1) & 0x3f;
      return;
    }

    const cell = this.cellAt(this.address);
    if (cell >= 0) this.ddram[cell] = value;
    // Autoscroll: the glass moves the way the counter is going, so the character
    // just written stays on the edge the cursor reached rather than walking off.
    if (this.scrolling) this.viewShift += this.incrementing ? 1 : -1;
    this.address = (this.address + (this.incrementing ? 1 : -1)) & 0x7f;
    this.syncCursor();
  }

  /**
   * The cell a DDRAM address lands on, or -1 where this glass has no memory.
   *
   * An address in a gap is accepted and simply stores nothing, which is what a
   * controller does when it is handed an address its own display has no cell for.
   */
  private cellAt(address: number): number {
    for (let row = 0; row < this.rows; row++) {
      const offset = address - this.rowBases[row];
      if (offset >= 0 && offset < this.columns) return row * this.columns + offset;
    }
    return -1;
  }

  /** The cell a screen position shows, honouring any scrolling of the display. */
  private screenCell(row: number, column: number): number {
    if (row < 0 || row >= this.rows) return -1;
    return this.cellAt(this.rowBases[row] + column - this.viewShift);
  }

  private cellRow(cell: number, row: number): number {
    const code = this.ddram[cell];
    return code < CGRAM_SLOTS
      ? this.cgramRows[code * LCD_CELL_HEIGHT + row]
      : ROM_CELLS[romIndex(code) * LCD_CELL_HEIGHT + row];
  }

  /**
   * Moves the reported cursor to wherever the address counter now points.
   *
   * The counter is one register shared by both memories, so while it points at
   * CGRAM the cursor has no cell of its own to sit in and the controller does
   * not draw one.
   */
  private syncCursor(): void {
    const cell = this.inCgram ? -1 : this.cellAt(this.address);
    this.cursor.row = cell < 0 ? 0 : Math.floor(cell / this.columns);
    this.cursor.column = cell < 0 ? -1 : cell - this.cursor.row * this.columns + this.viewShift;
    this.cursor.visible = this.displayOnBit && this.cursorOnBit && cell >= 0;
  }
}
