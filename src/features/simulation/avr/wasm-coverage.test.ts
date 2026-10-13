import { describe, expect, it } from 'vitest';
import { coverage } from './wasm/coverage';

describe('coverage math', () => {
  const rank = [
    { opcode: 'pc:a', count: 800 },
    { opcode: 'pc:b', count: 150 },
    { opcode: 'pc:c', count: 50 },
  ];

  it('weights by executed count, not distinct opcodes', () => {
    expect(coverage(rank, new Set(['pc:a']))).toEqual({ covered: 800, total: 1000, rate: 0.8 });
    expect(coverage(rank, new Set(['pc:b', 'pc:c']))).toEqual({ covered: 200, total: 1000, rate: 0.2 });
    expect(coverage(rank, new Set())).toEqual({ covered: 0, total: 1000, rate: 0 });
    expect(coverage([], new Set(['pc:a']))).toEqual({ covered: 0, total: 0, rate: 0 });
  });
});
