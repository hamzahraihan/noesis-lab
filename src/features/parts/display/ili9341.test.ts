import { describe, expect, it } from 'vitest';
import { Ili9341, ILI9341_HEIGHT, ILI9341_WIDTH } from './ili9341';

/**
 * Sends a command with its parameters inside one chip-select window.
 *
 * The first byte goes with D/C low and the parameters with D/C high -- that
 * pin is the only thing telling the controller which is which.
 */
function command(display: Ili9341, opcode: number, ...parameters: number[]): void {
  display.receive(opcode, false, true);
  for (const byte of parameters) display.receive(byte, true, true);
}

/**
 * Raises chip-select, ending whatever sequence is in flight.
 *
 * This is not a formality: chip-select rising is what tells the controller a
 * pixel stream has finished, so a 0x2C command and the bytes after it have to
 * share one window or nothing is ever drawn.
 */
function deselect(display: Ili9341): void {
  display.receive(0, false, false);
}

/** Streams RGB565 bytes as data, leaving chip-select low. */
function data(display: Ili9341, ...bytes: number[]): void {
  for (const byte of bytes) display.receive(byte, true, true);
}

/** The standard 320x240 window setup every TFT sketch begins with. */
function setFullWindow(display: Ili9341): void {
  command(display, 0x2a, 0x00, 0x00, 0x01, 0x3f); // columns 0..319
  command(display, 0x2b, 0x00, 0x00, 0x00, 0xef); // rows 0..239
  deselect(display);
}

describe('ILI9341 addressing', () => {
  it('starts dark and lights on the display-on command', () => {
    const display = new Ili9341();
    expect(display.isOn()).toBe(false);
    command(display, 0x29);
    expect(display.isOn()).toBe(true);
    command(display, 0x28);
    expect(display.isOn()).toBe(false);
  });

  it('writes RGB565 pixels in high-byte-first order', () => {
    const display = new Ili9341();
    setFullWindow(display);
    command(display, 0x2c);

    // Pure red in RGB565 is 0xF800.
    data(display, 0xf8, 0x00);
    deselect(display);

    expect(display.pixelAt(0, 0)).toBe(0xf800);
    expect(display.pixelAt(1, 0)).toBe(0);
  });

  it('advances a pixel at a time across the row', () => {
    const display = new Ili9341();
    setFullWindow(display);
    command(display, 0x2c);

    // Three whole pixels: red, green, blue.
    data(display, 0xf8, 0x00, 0x07, 0xe0, 0x00, 0x1f);
    deselect(display);

    expect(display.pixelAt(0, 0)).toBe(0xf800);
    expect(display.pixelAt(1, 0)).toBe(0x07e0);
    expect(display.pixelAt(2, 0)).toBe(0x001f);
    expect(display.pixelAt(3, 0)).toBe(0);
  });

  it('wraps to the next row at the end of a full-width write', () => {
    const display = new Ili9341();
    setFullWindow(display);
    command(display, 0x2c);

    // One full row of green, then a single pixel's worth of red.
    const row = new Array<number>(ILI9341_WIDTH * 2).fill(0).map((_, i) =>
      i % 2 === 0 ? 0x00 : 0x07,
    );
    data(display, ...row, 0xf8, 0x00);
    deselect(display);

    expect(display.pixelAt(0, 0)).toBe(0x0007);
    expect(display.pixelAt(ILI9341_WIDTH - 1, 0)).toBe(0x0007);
    expect(display.pixelAt(0, 1)).toBe(0xf800);
  });

  it('honours a restricted column window', () => {
    const display = new Ili9341();
    command(display, 0x2a, 0x00, 0x02, 0x00, 0x05); // columns 2..5
    command(display, 0x2b, 0x00, 0x00, 0x00, 0x07);
    command(display, 0x2c);

    data(display, ...new Array<number>((5 - 2 + 1) * 2).fill(0).map((_, i) => (i % 2 ? 0xff : 0x00)));
    deselect(display);

    expect(display.pixelAt(2, 0)).toBe(0x00ff);
    expect(display.pixelAt(5, 0)).toBe(0x00ff);
    expect(display.pixelAt(6, 0)).toBe(0);
    expect(display.pixelAt(1, 0)).toBe(0);
  });

  it('records the memory access control orientation flags', () => {
    const display = new Ili9341();
    command(display, 0x36, 0x00);
    expect(display.isMirrored).toBe(false);
    command(display, 0x36, 0x80);
    expect(display.isMirrored).toBe(true);
  });
});

describe('ILI9341 chip select', () => {
  it('abandons a half-sent command when chip-select rises', () => {
    const display = new Ili9341();
    setFullWindow(display);

    // Start a column window, send half of it, then drop chip-select.
    display.receive(0x2a, false, true);
    display.receive(0x00, true, true);
    display.receive(0x00, false, false);
    display.receive(0, false, false);

    // The next data byte must land as a command boundary, not an argument.
    command(display, 0x2c);
    data(display, 0xf8, 0x00);
    deselect(display);
    expect(display.pixelAt(0, 0)).toBe(0xf800);
  });

  it('writes no pixels while chip-select is high', () => {
    const display = new Ili9341();
    setFullWindow(display);
    command(display, 0x2c);
    // Chip-select never went low for these bytes.
    display.receive(0xf8, true, false);
    display.receive(0x00, true, false);
    expect(display.pixelAt(0, 0)).toBe(0);
  });

  it('treats every byte as data when D/C is stuck high', () => {
    // The classic miswire: commands arrive as pixel data and nothing is drawn.
    const display = new Ili9341();
    for (const byte of [0x29, 0x2a, 0x2b, 0x2c]) {
      display.receive(byte, true, true);
    }
    display.receive(0, true, false);

    expect(display.isOn()).toBe(false);
  });
});

describe('ILI9341 framebuffer', () => {
  it('clears every pixel', () => {
    const display = new Ili9341();
    setFullWindow(display);
    command(display, 0x2c);
    data(display, 0xff, 0xff, 0xff, 0xff);
    deselect(display);
    expect(display.pixelAt(0, 0)).toBe(0xffff);

    display.clear();
    expect(display.pixelAt(0, 0)).toBe(0);
  });

  it('reports out-of-range pixels as black rather than throwing', () => {
    const display = new Ili9341();
    expect(display.pixelAt(-1, 0)).toBe(0);
    expect(display.pixelAt(ILI9341_WIDTH, 0)).toBe(0);
    expect(display.pixelAt(0, ILI9341_HEIGHT)).toBe(0);
  });

  it('expands to a full RGBA image for rendering', () => {
    const display = new Ili9341();
    const rgba = display.toRgba();
    expect(rgba).toHaveLength(ILI9341_WIDTH * ILI9341_HEIGHT * 4);
    // Opaque black by default, so the panel never renders as transparent.
    expect(rgba[3]).toBe(255);
    expect([rgba[0], rgba[1], rgba[2]]).toEqual([0, 0, 0]);
  });

  it('renders pure red at full scale in the expanded image', () => {
    const display = new Ili9341();
    setFullWindow(display);
    command(display, 0x2c);
    data(display, 0xf8, 0x00);
    deselect(display);

    const rgba = display.toRgba();
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([255, 0, 0, 255]);
  });

  it('returns to the datasheet state after a software reset', () => {
    const display = new Ili9341();
    command(display, 0x29);
    command(display, 0x36, 0x80);
    command(display, 0x2a, 0x00, 0x10, 0x00, 0x20);
    expect(display.isMirrored).toBe(true);

    command(display, 0x01);
    expect(display.isOn()).toBe(false);
    expect(display.isMirrored).toBe(false);
  });
});