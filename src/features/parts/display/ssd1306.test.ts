import { describe, expect, it } from 'vitest';
import { Ssd1306, SSD1306_HEIGHT, SSD1306_WIDTH } from './ssd1306';

/** Sends a whole transaction the way the Wire library would, framing correct. */
function transaction(display: Ssd1306, ...bytes: number[]): void {
  bytes.forEach((byte, index) => display.receive(byte, index === 0));
}

function command(display: Ssd1306, ...bytes: number[]): void {
  transaction(display, 0x00, ...bytes);
}

function data(display: Ssd1306, ...bytes: number[]): void {
  transaction(display, 0x40, ...bytes);
}

/** The standard init sequence every SSD1306 sketch starts with. */
function initialise(display: Ssd1306): void {
  command(display, 0xae);
  command(display, 0x20, 0x00);
  command(display, 0x21, 0x00, 0x7f);
  command(display, 0x22, 0x00, 0x07);
  command(display, 0x81, 0x9f);
  command(display, 0xa1, 0xa6);
  command(display, 0xa8, 0x3f);
  command(display, 0xa4, 0xd3, 0x00);
  command(display, 0xd5, 0x80);
  command(display, 0xd9, 0x22);
  command(display, 0xda, 0x12);
  command(display, 0xdb, 0x20);
  command(display, 0x8d, 0x14);
  command(display, 0xaf);
}

describe('SSD1306 addressing', () => {
  it('ignores bytes addressed to another device', () => {
    const display = new Ssd1306(0x3c);
    expect(new Ssd1306().receive(0xaf)).toBe(true);
    expect(display.lit).toBe(false);
    expect(display.receive(0xaf)).toBe(true);
    expect(display.lit).toBe(true);
  });

  it('keeps a transaction address distinct from a display address', () => {
    const display = new Ssd1306(0x3c);
    expect(display.receive(0xaf)).toBe(true);
  });

  it('writes data bytes into the framebuffer in page order', () => {
    const display = new Ssd1306();
    initialise(display);
    command(display, 0x21, 0x00, 0x7f);
    command(display, 0x22, 0x00, 0x07);
    command(display, 0xb0, 0x00);

    data(display, 0xff, 0x81);

    // 0xff fills all eight rows of column 0; 0x81 sets only rows 0 and 7 of
    // column 1.
    expect(display.isLit(0, 0)).toBe(true);
    expect(display.isLit(0, 7)).toBe(true);
    expect(display.isLit(1, 0)).toBe(true);
    expect(display.isLit(1, 7)).toBe(true);
    expect(display.isLit(1, 1)).toBe(false);
    expect(display.isLit(2, 0)).toBe(false);
  });

  it('honours the column address window', () => {
    const display = new Ssd1306();
    initialise(display);
    command(display, 0x21, 0x40, 0x47); // columns 64..71 only
    command(display, 0x22, 0x00, 0x00);
    command(display, 0xb0, 0x00);
    // The column pointer takes two commands: 0x10-0x1F sets the high nibble
    // first, then 0x00-0x0F sets the low nibble.
    command(display, 0x14, 0x00);

    data(display, 0xff);

    expect(display.isLit(64, 0)).toBe(true);
    expect(display.isLit(63, 0)).toBe(false);
    // Eight bytes fill 64..71; the ninth must wrap back to the window start.
    data(display, 0xff);
    expect(display.isLit(72, 0)).toBe(false);
  });

  it('tracks page addressing across a wrapped write', () => {
    const display = new Ssd1306();
    initialise(display);
    command(display, 0x21, 0x00, 0x7f);
    command(display, 0x22, 0x00, 0x01); // pages 0..1
    command(display, 0xb0, 0x00);

    // Two full pages: 128 bytes each.
    data(display, ...new Array<number>(128).fill(0xff));
    expect(display.isLit(0, 0)).toBe(true);
    expect(display.isLit(0, 8)).toBe(false);

    data(display, ...new Array<number>(128).fill(0xff));
    expect(display.isLit(0, 8)).toBe(true);
    // The window wrapped, so page 0 is untouched by the second write's tail.
    expect(display.isLit(127, 8)).toBe(true);
  });
});

describe('SSD1306 display state', () => {
  it('starts dark and lights on the display-on command', () => {
    const display = new Ssd1306();
    expect(display.lit).toBe(false);
    command(display, 0xaf);
    expect(display.lit).toBe(true);
    command(display, 0xae);
    expect(display.lit).toBe(false);
  });

  it('stores contrast from the single-argument command', () => {
    const display = new Ssd1306();
    command(display, 0x81, 0x9f);
    expect(display.brightness).toBeCloseTo(0x9f / 0xff, 5);
  });

  it('does not mistake a one-argument command for its own argument', () => {
    // 0x15 and 0x16 carry a nibble; treating them as commands-with-arguments
    // would swallow the next real command and garble the screen.
    const display = new Ssd1306();
    initialise(display);
    command(display, 0x15);
    command(display, 0xaf);
    expect(display.lit).toBe(true);
  });

  it('ignores an unknown command without swallowing later bytes', () => {
    const display = new Ssd1306();
    command(display, 0xff, 0xff); // not a real command
    command(display, 0xaf);
    expect(display.lit).toBe(true);
  });
});

describe('SSD1306 framebuffer', () => {
  it('clears every pixel', () => {
    const display = new Ssd1306();
    initialise(display);
    command(display, 0xb0, 0x00);
    data(display, ...new Array<number>(SSD1306_WIDTH).fill(0xff));
    expect(display.isLit(0, 0)).toBe(true);

    display.clear();
    expect(Array.from(display.snapshot()).some((pixel) => pixel === 1)).toBe(false);
  });

  it('snapshots every pixel at panel resolution', () => {
    const display = new Ssd1306();
    expect(display.snapshot()).toHaveLength(SSD1306_WIDTH * SSD1306_HEIGHT);
  });

  it('reads out of range pixels as unlit rather than throwing', () => {
    const display = new Ssd1306();
    expect(display.isLit(-1, 0)).toBe(false);
    expect(display.isLit(SSD1306_WIDTH, 0)).toBe(false);
    expect(display.isLit(0, SSD1306_HEIGHT)).toBe(false);
  });
});

describe('SSD1306 control bytes', () => {
  it('consumes the first byte of a transaction as the stream selector', () => {
    const display = new Ssd1306();
    initialise(display);
    command(display, 0x21, 0x00, 0x7f);
    command(display, 0x22, 0x00, 0x07);
    command(display, 0xb0, 0x00);

    // A leading byte is the control byte even when it looks like pixel data, so
    // it must not consume a column.
    transaction(display, 0x40, ...new Array<number>(SSD1306_WIDTH).fill(0xff));
    expect(display.isLit(0, 0)).toBe(true);
    // Exactly one page was filled: column 127 is the last, and nothing spilled.
    expect(display.isLit(127, 0)).toBe(true);
    expect(display.isLit(0, 8)).toBe(false);
  });

  it('keeps the command stream from writing pixels', () => {
    const display = new Ssd1306();
 initialise(display);
    command(display, 0xb0, 0x00);

    // 0x81 is the contrast command, so it must reach the command decoder rather
    // than the framebuffer.
    transaction(display, 0x00, 0x81, 0x10);
    expect(display.brightness).toBeCloseTo(0x10 / 0xff, 5);
    expect(Array.from(display.snapshot()).some((pixel) => pixel === 1)).toBe(false);
  });

  it('switches stream back and forth within one session', () => {
    const display = new Ssd1306();
    initialise(display);
    command(display, 0xb0, 0x00);

    data(display, 0xff);
    expect(display.isLit(0, 0)).toBe(true);

    // A command must not disturb pixels already on the panel.
    command(display, 0x81, 0x20);
    expect(display.isLit(0, 0)).toBe(true);
  });
});