/**
 * Character LCD modules: the 16x2 and the 20x4.
 *
 * These are the parallel parts. Nothing on a character LCD talks to a bus: it is
 * driven by putting bytes on its own data lines and pulsing E, so the wiring is
 * the whole interface. A display on the wrong pins therefore shows nothing, and
 * nothing here joins the signal pins together to paper over that -- the two
 * supply pins are the only internal connections, exactly as on the OLED.
 *
 * Both sizes are the same module with more glass, and the element says so: the
 * 20x4 element is the 16x2 element with its column and row counts changed. What
 * the size changes is the box, the height of the header, and where each row
 * lives in DDRAM -- and the last of those is the controller's answer, not this
 * file's.
 */

import type { LcdVariant, PartDefinition, PinSpec } from '../catalog';
import {
  LCD_1602_COLUMNS,
  LCD_1602_ROWS,
  LCD_2004_COLUMNS,
  LCD_2004_ROWS,
  LCD_CELL_HEIGHT,
  LCD_CELL_WIDTH,
  Lcd1602,
} from './lcd1602';

/**
 * The hole pitch, and the grid this header is snapped to.
 *
 * The elements state their pins in the 96 dpi every other element uses, so they
 * arrive a fraction of a millimetre off a real 0.1 inch pitch and have to be
 * rounded onto it, or a jumper cannot reach them.
 */
const PITCH = 2.54;

/**
 * The header row, in the order the module silkscreens it.
 *
 * A sketch needs eight of these sixteen: VSS and VDD, RS, E and D4-D7, and the
 * two backlight pins. RW and D0-D3 are on the header because they are on the
 * part -- a driver put in 8-bit mode would want them -- not because anything
 * here connects them.
 *
 * `V0` is what the module and its element print for the contrast input; the
 * datasheet writes it `VO`. The backlight is `A` and `K`, the LED's two ends.
 */
const HEADER_NAMES: readonly string[] = [
  'VSS',
  'VDD',
  'V0',
  'RS',
  'RW',
  'E',
  'D0',
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'A',
  'K',
];

/** One variant's glass: what the element draws, and where its header sits. */
interface LcdGeometry {
  readonly columns: number;
  readonly rows: number;
  /** The element's own size: the glass plus the carrier around it. */
  readonly widthMm: number;
  readonly heightMm: number;
  /** First hole of the header row, snapped onto the grid. */
  readonly headerX: number;
  readonly headerY: number;
}

/**
 * 16x2, 80 x 36 mm.
 *
 * The element sizes itself off its own glass -- 3.5125 mm to a column, 5.75 mm
 * to a row -- plus 23.8 mm across and 24.5 mm down for the carrier around it,
 * which is what a real module measures.
 *
 * Its header is published at 8.467 mm along and 34.654 mm down, while the
 * artwork draws its holes at 8.377 and 34.6: the two disagree by most of a
 * millimetre because the pins table was rounded to whole pixels. Both land on
 * 8.255 and 34.29, the nearest half pitch -- the grid a breadboard can take, and
 * 1.7 mm clear of the bottom edge of the board.
 */
const LCD_1602_GEOMETRY: LcdGeometry = {
  columns: LCD_1602_COLUMNS,
  rows: LCD_1602_ROWS,
  widthMm: 80,
  heightMm: 36,
  headerX: 8.255,
  headerY: 34.29,
};

/**
 * 20x4, 94.05 x 47.5 mm.
 *
 * The same element at twenty columns and four rows, so the carrier is unchanged
 * and the glass is 14.05 mm wider and 11.5 mm taller. The header moves down with
 * the glass -- the element keeps it 21.1 mm below the bottom of the panel, which
 * is the same distance from the edge of the board on both sizes -- and lands at
 * 45.72 mm once snapped.
 */
const LCD_2004_GEOMETRY: LcdGeometry = {
  columns: LCD_2004_COLUMNS,
  rows: LCD_2004_ROWS,
  widthMm: 94.05,
  heightMm: 47.5,
  headerX: 8.255,
  headerY: 45.72,
};

function lcdDefinition(
  id: string,
  name: string,
  variant: LcdVariant,
  geometry: LcdGeometry,
): PartDefinition {
  return {
    id,
    name,
    category: 'output',
    widthMm: geometry.widthMm,
    heightMm: geometry.heightMm,
    component: { kind: 'lcd', variant },
    pins: HEADER_NAMES.map((label, index): PinSpec => ({
      id: label,
      label,
      x: geometry.headerX + index * PITCH,
      y: geometry.headerY,
      net: label === 'VSS' ? 'GND' : label === 'VDD' ? 'VCC' : undefined,
    })),
    bodyColour: '#087f45',
    legendColour: '#f0f4f2',
    // The glass, in the dots it is actually made of: five across and eight down
    // to a cell. A character LCD has no framebuffer of its own -- the controller
    // composes the glyphs -- but the dot grid is what a renderer draws.
    displayPixels: {
      width: geometry.columns * LCD_CELL_WIDTH,
      height: geometry.rows * LCD_CELL_HEIGHT,
    },
  };
}

/** 16x2 on the full sixteen-pin header, the module almost every tutorial means. */
export function lcd1602Definition(): PartDefinition {
  return lcdDefinition('lcd-16x2', 'LCD 16x2 (HD44780)', '1602', LCD_1602_GEOMETRY);
}

/**
 * 20x4: the same module, four rows instead of two.
 *
 * Its rows are not four consecutive blocks of twenty, so the address it answers
 * to differs from the 16x2's above row one. That is the controller's business,
 * and the reason the two are one model rather than two.
 */
export function lcd2004Definition(): PartDefinition {
  return lcdDefinition('lcd-20x4', 'LCD 20x4 (HD44780)', '2004', LCD_2004_GEOMETRY);
}

/** Instantiates the controller a character LCD part drives. */
export type { Lcd1602 } from './lcd1602';

export function createLcd(definition: PartDefinition): Lcd1602 | null {
  const component = definition.component;
  if (component.kind !== 'lcd') return null;
  const geometry = component.variant === '2004' ? LCD_2004_GEOMETRY : LCD_1602_GEOMETRY;
  return new Lcd1602(geometry.columns, geometry.rows);
}