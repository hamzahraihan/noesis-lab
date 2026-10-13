import { describe, expect, it } from 'vitest';

function unpack(packed: number): { result: number; sreg: number } {
  return { result: packed & 0xff, sreg: (packed >>> 8) & 0xff };
}

describe('alu_add', () => {
  it('computes result and all six flags', async () => {
    const { alu_add, alu_sub } = await import('./wasm/ops-alu-stub');
    expect(unpack(alu_add(0x05, 0x03, 0))).toEqual({ result: 0x08, sreg: 0x00 });
    expect(unpack(alu_add(0x7f, 0x01, 0))).toEqual({ result: 0x80, sreg: 0x2c });
    expect(unpack(alu_add(0xff, 0x01, 0))).toEqual({ result: 0x00, sreg: 0x23 });
    expect(unpack(alu_add(0x0f, 0x01, 0)).sreg & 0x20).toBe(0x20);
    expect(unpack(alu_sub(0x10, 0x01, 0))).toEqual({ result: 0x0f, sreg: 0x20 });
    expect(unpack(alu_sub(0x80, 0x01, 0))).toEqual({ result: 0x7f, sreg: 0x38 });
  });
});
