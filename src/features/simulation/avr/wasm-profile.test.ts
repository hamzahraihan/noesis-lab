import { describe, expect, it } from 'vitest';
import { rankOpcodes } from './wasm/profile';

describe('op profiler', () => {
  it('ranks executed opcodes by count', () => {
    const rank = rankOpcodes(new Uint16Array([0x0000, 0x0000, 0xc000]), 6);
    expect(rank.length).toBeGreaterThan(0);
    expect(rank[0]!.count).toBeGreaterThanOrEqual(rank[rank.length - 1]!.count);
    const total = rank.reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBe(6);
  });
});
