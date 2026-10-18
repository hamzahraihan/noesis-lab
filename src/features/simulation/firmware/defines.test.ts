import { describe, expect, it } from 'vitest';
import { parseFirmware } from './parser';

const definesOf = (source: string): ReadonlyMap<string, number> =>
  parseFirmware(`${source}\nvoid setup() { delay(1); }\nvoid loop() { delay(1); }`).defines;

describe('#define', () => {
  it('reads decimal constants', () => {
    const defines = definesOf('#define PIN 2\n#define MS 1000');
    expect(defines.get('PIN')).toBe(2);
    expect(defines.get('MS')).toBe(1000);
  });

  it('reads hex constants', () => {
    // The bug this guards: a decimal-only pattern made `#define ADDR 0x3C`
    // define nothing, so the sketch silently addressed the display at 0.
    const defines = definesOf('#define OLED_ADDR 0x3C');
    expect(defines.get('OLED_ADDR')).toBe(0x3c);
  });

  it('reads hex constants ending in F', () => {
    const defines = definesOf('#define MASK 0xFF');
    expect(defines.get('MASK')).toBe(0xff);
  });

  it('reads negative and float constants', () => {
    const defines = definesOf('#define OFFSET -1\n#define SCALE 0.5');
    expect(defines.get('OFFSET')).toBe(-1);
    expect(defines.get('SCALE')).toBeCloseTo(0.5, 6);
  });

  it('defines an expression-like value as zero rather than mis-parsing it', () => {
    // `#define X (1 << 3)` has no single literal in it; the VM has no macro
    // expander, so it resolves to 0 rather than silently becoming 1.
    const defines = definesOf('#define X (1 << 3)');
    expect(defines.get('X')).toBe(0);
  });

  it('ignores #include and other directives', () => {
    const defines = definesOf('#include <Wire.h>\n#include "thing.h"');
    expect(defines.size).toBe(0);
  });

  it('exposes a defined constant to the interpreter', () => {
    const program = parseFirmware(`
      #define OLED_ADDR 0x3C
      void setup() { Wire.beginTransmission(OLED_ADDR); }
      void loop() { delay(1); }`);
    expect(program.defines.get('OLED_ADDR')).toBe(60);
    expect(program.functions.has('setup')).toBe(true);
  });
});
