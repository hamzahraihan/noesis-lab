/**
 * The `LiquidCrystal` half of a character LCD: turning a sketch's calls into
 * the HD44780's own protocol.
 *
 * The panel model below already speaks that protocol -- it is what the Wokwi
 * element is and what the silicon is -- so everything here is the *library*:
 * which commands a `lcd.setCursor` turns into, and in what order. That split is
 * the point, because it is the library that decides those things on hardware,
 * and a sketch that works here works on a real panel.
 *
 * The one thing this file cannot do is lie. Every command goes out on the
 * panel's own RS, D4-D7 and E pins, and the engine reads those pins back, so a
 * display wired to the wrong header stays blank exactly as it would be.
 */

import type { Lcd1602 } from './lcd1602';

/** The glass: how many characters, and where each row starts in DDRAM. */
interface Geometry {
  readonly columns: number;
  readonly rows: number;
}

/**
 * Row addresses for the two panels the library ships geometries for.
 *
 * A 16x2 has a gap between its rows at 0x10; a 20x4 has one between every
 * pair. Getting these wrong is the classic character-LCD bug: the top line
 * works, the second is blank or shows fragments of the first.
 */
function geometryFor(columns: number, rows: number): Geometry {
  return { columns, rows };
}

/** HD44780 instructions this library issues. */
const CLEAR_DISPLAY = 0x01;
const RETURN_HOME = 0x02;
const ENTRY_MODE_INCREMENT = 0x06;
const DISPLAY_ON = 0x0c;
const FUNCTION_SET_8BIT_2LINE = 0x28;
const SET_DDRAM_ADDRESS = 0x80;

export interface LcdCommand {
  /** RS high for a character, low for a command. */
  readonly isData: boolean;
  readonly value: number;
}

/**
 * A `LiquidCrystal` bound to one panel.
 *
 * The library does not hold the panel: it holds where the cursor is and what
 * has to go out next, which is all the state a character LCD library keeps.
 */
export class LcdDriver {
  private readonly panel: Lcd1602;
  private geometry: Geometry = geometryFor(16, 2);
  private row = 0;
  private column = 0;

  constructor(panel: Lcd1602) {
    this.panel = panel;
  }

  /** The panel this driver is talking to. */
  get target(): Lcd1602 {
    return this.panel;
  }

  /** Commands `begin` puts on the wire, and the size it settles on. */
  begin(columns: number, rows: number): readonly LcdCommand[] {
    this.geometry = geometryFor(Math.max(1, Math.floor(columns)), Math.max(1, Math.floor(rows)));
    this.row = 0;
    this.column = 0;
    return [
      { isData: false, value: FUNCTION_SET_8BIT_2LINE },
      { isData: false, value: DISPLAY_ON },
      { isData: false, value: ENTRY_MODE_INCREMENT },
      { isData: false, value: CLEAR_DISPLAY },
      { isData: false, value: RETURN_HOME },
    ];
  }

  clear(): readonly LcdCommand[] {
    this.row = 0;
    this.column = 0;
    return [
      { isData: false, value: CLEAR_DISPLAY },
      { isData: false, value: RETURN_HOME },
    ];
  }

  home(): readonly LcdCommand[] {
    this.row = 0;
    this.column = 0;
    return [{ isData: false, value: RETURN_HOME }];
  }

  setCursor(column: number, row: number): readonly LcdCommand[] {
    const rowAddress = this.panel.rowBase(Math.min(row, this.geometry.rows - 1));
    this.column = Math.max(0, Math.floor(column));
    this.row = Math.max(0, Math.floor(row));
    /*
     * Pointing the address is the whole of setCursor: once DDRAM is addressed,
     * every byte after it is data, which is why there is no "write characters"
     * command to send -- there is not one.
     *
     * The address is seven bits, and the second row of a 16x2 sits at 0x40. A
     * six-bit mask drops it, which puts every row on the first and is why a
     * display wired and driven correctly still shows one line.
     */
    const address = SET_DDRAM_ADDRESS | (rowAddress & 0x7f) | (this.column & 0x3f);
    return [{ isData: false, value: address }];
  }

  /** Characters, each preceded by the command that puts the panel in data mode. */
  text(value: string): readonly LcdCommand[] {
    const commands: LcdCommand[] = [];
    for (const character of value) {
      commands.push({ isData: true, value: character.charCodeAt(0) });
    }
    this.column += value.length;
    return commands;
  }

  /** One byte as data: a character, or a glyph the panel has been given. */
  byte(value: number): readonly LcdCommand[] {
    this.column += 1;
    return [{ isData: true, value: value & 0xff }];
  }

  /**
   * A custom glyph, which lives in CGRAM rather than in the character set.
   *
   * Eight rows, each a bitmask of the five columns a cell has, and the panel
   * is pointed at the slot before they go in.
   */
  createChar(slot: number, bitmap: readonly number[]): readonly LcdCommand[] {
    const index = Math.min(7, Math.max(0, Math.floor(slot)));
    const commands: LcdCommand[] = [{ isData: false, value: SET_DDRAM_ADDRESS | index }];
    for (let row = 0; row < 8; row++) {
      commands.push({ isData: true, value: row < bitmap.length ? bitmap[row] & 0x1f : 0 });
    }
    // Back to where the cursor was: CGRAM is a detour, not a move.
    const returnTo =
      SET_DDRAM_ADDRESS | (this.panel.rowBase(this.row) & 0x3f) | (this.column & 0x3f);
    return [...commands, { isData: false, value: returnTo }];
  }
}
