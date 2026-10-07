import { describe, expect, it } from 'vitest';
import { tokenize, parseFirmware } from './parser';

/** First numeric literal in a fragment, with its value. */
function firstNumber(source: string): number {
  const token = tokenize(source).find((candidate) => candidate.kind === 'number');
  return token?.value ?? NaN;
}

describe('numeric literals', () => {
  it('reads decimal integers', () => {
    expect(firstNumber('42')).toBe(42);
    expect(firstNumber('0')).toBe(0);
  });

  it('reads hex literals', () => {
    expect(firstNumber('0x3C')).toBe(0x3c);
    expect(firstNumber('0xae')).toBe(0xae);
    expect(firstNumber('0XFF')).toBe(0xff);
  });

  it('does not mistake a trailing F in a hex literal for a float suffix', () => {
    // The bug this guards: 0xAF became 0xA and 0xFF became 0xF, corrupting every
    // display command ending in a nibble of F -- silently, with no error.
    expect(firstNumber('0xAF')).toBe(0xaf);
    expect(firstNumber('0xFF')).toBe(0xff);
    expect(firstNumber('0xBF')).toBe(0xbf);
    expect(firstNumber('0xf0')).toBe(0xf0);
  });

  it('reads decimal floats', () => {
    expect(firstNumber('1.5')).toBeCloseTo(1.5, 6);
    expect(firstNumber('3.14159')).toBeCloseTo(3.14159, 5);
    expect(firstNumber('1e3')).toBeCloseTo(1000, 6);
  });

  it('still honours the C float suffix on decimal literals', () => {
    expect(firstNumber('1.5f')).toBeCloseTo(1.5, 6);
    expect(firstNumber('2F')).toBeCloseTo(2, 6);
  });

  it('round-trips a hex constant used as an I2C address', () => {
    const program = parseFirmware(`
      int address = 0x3C;
      void setup() { Wire.beginTransmission(address); }
      void loop() { delay(1); }`);
    expect(program.functions.has('setup')).toBe(true);
  });
});