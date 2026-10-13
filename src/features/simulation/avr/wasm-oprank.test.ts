import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('op-rank data', () => {
  it('is a non-empty descending ranking', () => {
    const raw = readFileSync('src/features/simulation/avr/wasm/op-rank.json', 'utf8');
    const rank = JSON.parse(raw) as Array<{ opcode: string; count: number }>;
    expect(rank.length).toBeGreaterThan(0);
    for (let i = 1; i < rank.length; i++) {
      expect(rank[i - 1]!.count).toBeGreaterThanOrEqual(rank[i]!.count);
    }
    const total = rank.reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBeGreaterThan(1000);
  });
});
