import { describe, expect, it } from 'vitest';
import { SEGMENT_MAP } from './display/sevensegment';
import { tm1637Definition, Tm1637 } from './tm1637';

describe('the TM1637', () => {
  it('puts data into the register the address command named', () => {
    const display = new Tm1637();
    display.transaction(0xc0, [0x3f]);
    expect(display.digits[0]).toBe(0x3f);
    expect(display.digits[1]).toBe(0);
  });

  it('walks the address on as the data lands', () => {
    const display = new Tm1637();
    display.transaction(0xc0, [0x06, 0x5b]);
    expect(display.digits[0]).toBe(0x06);
    expect(display.digits[1]).toBe(0x5b);
  });

  it('takes a data byte that looks like a command for data', () => {
    const display = new Tm1637();
    // The decimal point on its own is 0x80, which is the display control
    // command's shape: only the position in the transaction says which it is.
    display.transaction(0xc0, [0x80]);
    expect(display.digits[0]).toBe(0x80);
    expect(display.lit).toBe(false);
  });

  it('lights and dims the glass from the display control command', () => {
    const display = new Tm1637();
    expect(display.lit).toBe(false);

    display.transaction(0x88 | 0x05);
    expect(display.lit).toBe(true);
    expect(display.brightness).toBe(5);

    display.transaction(0x80);
    expect(display.lit).toBe(false);
  });

  it('shows a line of text as the segment patterns of the digits', () => {
    const display = new Tm1637();
    display.print('1234');
    expect(display.digits).toEqual([
      SEGMENT_MAP['1'],
      SEGMENT_MAP['2'],
      SEGMENT_MAP['3'],
      SEGMENT_MAP['4'],
    ]);
  });

  it('puts the colon on the decimal point of the second digit', () => {
    const display = new Tm1637();
    display.print('12:34');
    expect(display.digits[0]).toBe(SEGMENT_MAP['1']);
    expect(display.digits[1]).toBe(SEGMENT_MAP['2'] | 0x80);
    expect(display.digits[2]).toBe(SEGMENT_MAP['3']);
    expect(display.digits[3]).toBe(SEGMENT_MAP['4']);
  });

  it('blanks the digits a shorter line does not reach', () => {
    const display = new Tm1637();
    display.print('88');
    expect(display.digits).toEqual([SEGMENT_MAP['8'], SEGMENT_MAP['8'], 0, 0]);
  });

  it('sets the brightness the way the display control command carries it', () => {
    const display = new Tm1637();
    display.setBrightness(7);
    expect(display.lit).toBe(true);
    expect(display.brightness).toBe(7);

    display.setBrightness(0);
    expect(display.brightness).toBe(0);
  });

  it('reads the same either way: the protocol by hand or the convenience', () => {
    const byHand = new Tm1637();
    byHand.transaction(0xc0, [
      SEGMENT_MAP['8'],
      SEGMENT_MAP['8'],
      SEGMENT_MAP['8'],
      SEGMENT_MAP['8'],
    ]);

    const printed = new Tm1637();
    printed.print('8888');

    expect(printed.digits).toEqual(byHand.digits);
  });

  it('puts the registers back the way they were', () => {
    const display = new Tm1637();
    display.print('8888');
    display.restore([0x06, 0x06, 0x06, 0x06], false, 3);
    expect(display.digits).toEqual([0x06, 0x06, 0x06, 0x06]);
    expect(display.lit).toBe(false);
    expect(display.brightness).toBe(3);
  });
});

describe('the TM1637 module', () => {
  it('is a display with a four-pin header', () => {
    const definition = tm1637Definition();
    expect(definition.component).toEqual({ kind: 'tm1637' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['VCC', 'GND', 'CLK', 'DIO']);
  });
});
