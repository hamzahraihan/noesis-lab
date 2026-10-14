import { describe, expect, it } from 'vitest';
import { CPU, avrInstruction } from 'avr8js';
import { readShadowSreg, SREG_DATA_ADDR, writeShadowSreg } from './wasm-core';

describe('sreg address', () => {
  it('is the byte SEI sets bit 7 on', () => {
    const cpu = new CPU(new Uint16Array([0x9478, 0x0000]));
    avrInstruction(cpu);
    cpu.tick();
    expect(readShadowSreg(cpu.data)).toBe(0x80);
  });

  it('round-trips an opaque byte', () => {
    const data = new Uint8Array(128);
    writeShadowSreg(data, 0xaa);
    expect(readShadowSreg(data)).toBe(0xaa);
    expect(data[SREG_DATA_ADDR]).toBe(0xaa);
  });
});
