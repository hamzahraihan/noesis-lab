import { describe, expect, it } from 'vitest';
import {
  nokia5110Definition,
  PCD8544_FLAG_INVERSE,
  PCD8544_FLAG_LIT,
  PCD8544_FRAME_BYTES,
  PCD8544_WIDTH,
  Pcd8544,
} from './pcd8544';

/** Sends bytes the way the bus does: commands or data, all chip-selected. */
function send(panel: Pcd8544, data: boolean, ...bytes: number[]): void {
  for (const byte of bytes) panel.receive(byte, data, true);
}

/** Wakes the panel at the address a test wants to write to. */
function address(panel: Pcd8544, x: number, y: number): void {
  send(panel, false, 0x20, 0x0c, 0x80 | x, 0x40 | y);
}

describe('the PCD8544', () => {
  it('powers up blanked, with clear memory and minimum contrast', () => {
    const panel = new Pcd8544();
    expect(panel.lit).toBe(false);
    expect(panel.brightness).toBe(0);
    expect(panel.frame()).toEqual(new Uint8Array(PCD8544_FRAME_BYTES));
  });

  it('shows the bits written to an addressed column and bank', () => {
    const panel = new Pcd8544();
    address(panel, 3, 2);
    send(panel, true, 0b00000101);

    expect(panel.lit).toBe(true);
    expect(panel.isLit(3, 16)).toBe(true);
    expect(panel.isLit(3, 17)).toBe(false);
    expect(panel.isLit(3, 18)).toBe(true);
    expect(panel.isLit(4, 16)).toBe(false);
  });

  it('walks across the columns and wraps down a bank by default', () => {
    const panel = new Pcd8544();
    address(panel, PCD8544_WIDTH - 1, 1);
    send(panel, true, 0xff, 0x01);

    // The first byte fills the last column of bank 1; the next wraps to
    // column 0 of bank 2.
    expect(panel.isLit(PCD8544_WIDTH - 1, 8)).toBe(true);
    expect(panel.isLit(0, 16)).toBe(true);
    expect(panel.isLit(0, 17)).toBe(false);
  });

  it('walks down the banks then across a column in vertical addressing', () => {
    const panel = new Pcd8544();
    // Function set with V=1, then the address, then the display on.
    send(panel, false, 0x22, 0x0c, 0x80, 0x40 | 5);
    send(panel, true, 0xff, 0x01);

    // Bank 5 first, then wrapping to bank 0 of the next column.
    expect(panel.isLit(0, 40)).toBe(true);
    expect(panel.isLit(1, 0)).toBe(true);
    expect(panel.isLit(1, 1)).toBe(false);
  });

  it('sets contrast through the extended set, where addressing is not decoded', () => {
    const panel = new Pcd8544();
    send(panel, false, 0x21, 0x80 | 0x3f);
    expect(panel.brightness).toBeCloseTo(0x3f / 0x7f);
    // That 0x80 was the contrast voltage, not an address: a write lands where
    // the counter already was.
    send(panel, false, 0x20, 0x0c);
    send(panel, true, 0xff);
    expect(panel.isLit(3, 0)).toBe(false);
    expect(panel.isLit(0, 0)).toBe(true);
  });

  it('blanks on display control and inverts the whole glass', () => {
    const panel = new Pcd8544();
    address(panel, 0, 0);
    send(panel, true, 0b00000001);
    expect(panel.isLit(0, 0)).toBe(true);
    expect(panel.isLit(0, 1)).toBe(false);

    // 0x0D is display-on with every segment inverted.
    send(panel, false, 0x0d);
    expect(panel.inverted).toBe(true);
    expect(panel.isLit(0, 0)).toBe(false);
    expect(panel.isLit(0, 1)).toBe(true);

    send(panel, false, 0x08);
    expect(panel.lit).toBe(false);
    expect(panel.isLit(0, 1)).toBe(false);
  });

  it('restores a mirrored frame, its switches and its contrast', () => {
    const worker = new Pcd8544();
    address(worker, 2, 4);
    send(worker, true, 0b10000000);
    send(worker, false, 0x21, 0x80 | 0x40);

    const page = new Pcd8544();
    page.restore(worker.frame(), PCD8544_FLAG_LIT | PCD8544_FLAG_INVERSE, 0x40);

    // Inverted, so the seven clear bits of that byte read lit and the one set
    // bit reads dark.
    expect(page.isLit(2, 32)).toBe(true);
    expect(page.isLit(2, 39)).toBe(false);
    expect(page.brightness).toBeCloseTo(0x40 / 0x7f);
  });
});

describe('the Nokia 5110 module', () => {
  it('is a display with the eight header contacts the breakout has', () => {
    const definition = nokia5110Definition();
    expect(definition.component).toEqual({ kind: 'display', controller: 'pcd8544', address: 0 });
    expect(definition.pins.map((pin) => pin.id)).toEqual([
      'RESET',
      'CS',
      'DC',
      'MOSI',
      'SCK',
      'VCC',
      'BL',
      'GND',
    ]);
    expect(definition.displayPixels).toEqual({ width: 84, height: 48 });
  });
});
