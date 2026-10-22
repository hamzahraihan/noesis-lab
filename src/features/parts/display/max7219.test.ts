import { describe, expect, it } from 'vitest';
import { max7219Definition, MAX7219_FLAG_LIT, MAX7219_INTENSITY_SHIFT, Max7219 } from './max7219';

/**
 * Shifts one 16-bit frame the way the chip sees it: an address byte, a data
 * byte, then the chip-select rise that applies them.
 */
function frame(matrix: Max7219, address: number, data: number): void {
  matrix.receive(address, false, true);
  matrix.receive(data, false, true);
  matrix.latch();
}

describe('the MAX7219', () => {
  it('powers up shut down, with every register clear', () => {
    const matrix = new Max7219();
    expect(matrix.lit).toBe(false);
    expect(matrix.isLit(0, 0)).toBe(false);
    expect(matrix.frame()).toEqual(new Uint8Array(8));
  });

  it('lights a register bit at its column and row once woken', () => {
    const matrix = new Max7219();
    frame(matrix, 0x0c, 0x01);
    frame(matrix, 0x01, 0b00000101);

    expect(matrix.lit).toBe(true);
    expect(matrix.isLit(0, 0)).toBe(true);
    expect(matrix.isLit(0, 1)).toBe(false);
    expect(matrix.isLit(0, 2)).toBe(true);
    // Every other column is still clear.
    expect(matrix.isLit(1, 0)).toBe(false);
  });

  it('keeps the picture in shutdown and shows it again on wake', () => {
    const matrix = new Max7219();
    frame(matrix, 0x0c, 0x01);
    frame(matrix, 0x02, 0x80);
    frame(matrix, 0x0c, 0x00);

    expect(matrix.isLit(1, 7)).toBe(false);
    frame(matrix, 0x0c, 0x01);
    expect(matrix.isLit(1, 7)).toBe(true);
  });

  it('applies only the frame left in the shift register', () => {
    const matrix = new Max7219();
    frame(matrix, 0x0c, 0x01);
    // Four frames, one transaction, one latch: a sixteen-bit register cannot
    // hold the first pair by the time the chip-select rises.
    matrix.receive(0x01, false, true);
    matrix.receive(0xff, false, true);
    matrix.receive(0x02, false, true);
    matrix.receive(0x0f, false, true);
    matrix.latch();

    expect(matrix.isLit(0, 0)).toBe(false);
    expect(matrix.isLit(1, 0)).toBe(true);
  });

  it('drops a transaction too short to hold a frame', () => {
    const matrix = new Max7219();
    frame(matrix, 0x0c, 0x01);
    matrix.receive(0x01, false, true);
    matrix.latch();

    expect(matrix.frame()).toEqual(new Uint8Array(8));
  });

  it('takes brightness from the intensity register, masking its nibble', () => {
    const matrix = new Max7219();
    expect(matrix.brightness).toBe(0);
    frame(matrix, 0x0a, 0x0f);
    expect(matrix.brightness).toBe(1);
    frame(matrix, 0x0a, 0xff);
    expect(matrix.brightness).toBe(1);
  });

  it('stops the multiplex at the scan limit', () => {
    const matrix = new Max7219();
    frame(matrix, 0x0c, 0x01);
    frame(matrix, 0x01, 0xff);
    frame(matrix, 0x02, 0xff);
    frame(matrix, 0x03, 0xff);
    frame(matrix, 0x0b, 0x01);

    expect(matrix.isLit(1, 0)).toBe(true);
    expect(matrix.isLit(2, 0)).toBe(false);
  });

  it('lights the whole glass in display test and restores it after', () => {
    const matrix = new Max7219();
    frame(matrix, 0x0c, 0x01);
    frame(matrix, 0x01, 0x01);
    frame(matrix, 0x0f, 0x01);

    expect(matrix.isLit(7, 7)).toBe(true);

    frame(matrix, 0x0f, 0x00);
    expect(matrix.isLit(7, 7)).toBe(false);
    expect(matrix.isLit(0, 0)).toBe(true);
  });

  it('restores a mirrored frame without replaying the transaction', () => {
    const worker = new Max7219();
    frame(worker, 0x0c, 0x01);
    frame(worker, 0x0a, 0x09);
    frame(worker, 0x04, 0b10000001);

    const page = new Max7219();
    page.restore(worker.frame(), MAX7219_FLAG_LIT | (0x09 << MAX7219_INTENSITY_SHIFT));

    expect(page.lit).toBe(true);
    expect(page.isLit(3, 0)).toBe(true);
    expect(page.isLit(3, 7)).toBe(true);
    expect(page.isLit(2, 0)).toBe(false);
    expect(page.brightness).toBeCloseTo(9 / 15);
  });
});

describe('the MAX7219 module', () => {
  it('is a display with data in, chip select and clock on its header', () => {
    const definition = max7219Definition();
    expect(definition.component).toEqual({
      kind: 'display',
      controller: 'max7219',
      address: 0,
    });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['VCC', 'GND', 'DIN', 'CS', 'CLK']);
    expect(definition.displayPixels).toEqual({ width: 8, height: 8 });
  });
});
