import { describe, expect, it } from 'vitest';
import { sub8 } from './wasm/alu';

describe('alu sub', () => {
  it('reports nibble borrow corners', () => {
    expect(sub8(0x10, 0x01)).toEqual({ result: 0x0f, halfCarry: true, carry: false });
    expect(sub8(0x00, 0x01)).toEqual({ result: 0xff, halfCarry: true, carry: true });
    expect(sub8(0x05, 0x03)).toEqual({ result: 0x02, halfCarry: false, carry: false });
  });
});
