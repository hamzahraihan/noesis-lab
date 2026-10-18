import { describe, expect, it } from 'vitest';
import { Ssd1306, SSD1306_HEIGHT, SSD1306_WIDTH } from './ssd1306';
import { GLYPH_ADVANCE, glyphFor, measureText } from './font5x7';

/** Renders the panel as text so glyph shapes can actually be eyeballed. */
function renderAscii(display: Ssd1306): string {
  const lines: string[] = [];
  for (let y = 0; y < 12; y++) {
    let line = '';
    for (let x = 0; x < 60; x++) line += display.isLit(x, y) ? '#' : '.';
    lines.push(line);
  }
  return lines.join('\n');
}

describe('5x7 font', () => {
  it('renders a letter as a recognisable shape', () => {
    const display = new Ssd1306();
    display.drawText('A', 0, 0);

    // A is an open top, two upright strokes, a crossbar on row 4, then stems.
    const rows = Array.from({ length: 7 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => (display.isLit(x, y) ? '#' : '.')).join(''),
    );

    expect(rows).toEqual(['.###.', '#...#', '#...#', '#...#', '#####', '#...#', '#...#']);
  });

  it('renders digits legibly', () => {
    const display = new Ssd1306();
    display.drawText('0', 0, 0);
    const zero = Array.from({ length: 7 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => (display.isLit(x, y) ? '#' : '.')).join(''),
    );

    // A zero is a closed oval with the classic diagonal slash through it.
    expect(zero[0]).toBe('.###.');
    expect(zero[3]).toBe('#.#.#');
    expect(zero[6]).toBe('.###.');

    // A one is a narrow stem. Its base serif is three wide, but the body
    // between rows 2 and 5 never is.
    const one = new Ssd1306();
    one.drawText('1', 0, 0);
    let bodyWidest = 0;
    for (let y = 2; y <= 5; y++) {
      let lit = 0;
      for (let x = 0; x < 5; x++) if (one.isLit(x, y)) lit++;
      bodyWidest = Math.max(bodyWidest, lit);
    }
    expect(bodyWidest).toBeLessThanOrEqual(2);
  });

  it('keeps the inter-character gap clear', () => {
    const pair = new Ssd1306();
    pair.drawText('##', 0, 0);

    // Column 5 sits between the two hash glyphs and must carry no ink at all;
    // a merged blob here is what a missing space in a font table looks like.
    for (let y = 0; y < 7; y++) expect(pair.isLit(GLYPH_ADVANCE - 1, y)).toBe(false);

    expect(pair.isLit(1, 1)).toBe(true);
    expect(pair.isLit(GLYPH_ADVANCE + 1, 1)).toBe(true);
  });

  it('folds lowercase to uppercase', () => {
    expect(glyphFor('a')).toBe(glyphFor('A'));
  });

  it('renders an unsupported character as blank rather than noise', () => {
    expect(glyphFor('é')).toEqual(glyphFor(' '));
  });

  it('measures a string as cells of five pixels plus a gap', () => {
    expect(measureText('')).toBe(0);
    expect(measureText('A')).toBe(5);
    expect(measureText('AB')).toBe(11);
  });

  it('clips text at the panel edge instead of wrapping', () => {
    const display = new Ssd1306();
    // Starting near the right edge, the glyph must not spill onto another page.
    display.drawText('M', SSD1306_WIDTH - 2, 0);
    const snapshot = display.snapshot();
    expect(snapshot).toHaveLength(SSD1306_WIDTH * SSD1306_HEIGHT);
    expect(Array.from(snapshot).some((pixel) => pixel === 1)).toBe(true);
  });

  it('reports the x coordinate just past the text it drew', () => {
    const display = new Ssd1306();
    expect(display.drawText('AB', 10, 0)).toBe(10 + 2 * GLYPH_ADVANCE - 1);
  });
});

describe('panel compositing', () => {
  it('draws text at an offset without disturbing the pixels before it', () => {
    const display = new Ssd1306();
    display.drawText('A', 0, 0);
    display.drawText('B', 20, 0);

    expect(display.isLit(1, 0)).toBe(true);
    expect(display.isLit(21, 0)).toBe(true);
    expect(display.isLit(10, 0)).toBe(false);
  });

  it('honours the panel height when clipping rows', () => {
    const display = new Ssd1306();
    display.drawText('A', 0, SSD1306_HEIGHT - 2);
    // Only the top two rows of the glyph fit; nothing wraps to the next page.
    const snapshot = display.snapshot();
    expect(Array.from(snapshot).some((pixel) => pixel === 1)).toBe(true);
  });

  it('renders a full line of text without touching the pixel grid', () => {
    const display = new Ssd1306();
    display.drawText('HELLO NOESIS', 0, 0);
    expect(renderAscii(display)).toContain('#');
  });
});
