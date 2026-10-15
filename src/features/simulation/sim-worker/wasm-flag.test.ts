import { describe, expect, it } from 'vitest';
import { createSimCore } from './core';
import { boardOption } from '@/features/learn/boardRegistry';

function benchOf(boardId: 'uno'): never {
  const board = boardOption(boardId).make();
  return {
    parts: [{ id: 'board', definition: board, x: 0, y: 0, rotation: 0, terminals: {} }],
    wires: [],
    terminals: [],
    revision: 0,
  } as never;
}

const firmware = {
  language: 'arduino-cpp',
  activeName: 'main.ino',
  files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
} as never;

describe('wasm flag', () => {
  it('rebuilds identically with the flag on or off (ignored until the driver lands)', () => {
    const off = createSimCore(boardOption('uno').make());
    off.rebuild(benchOf('uno'), firmware, 'interpreter', false);
    const on = createSimCore(boardOption('uno').make());
    on.rebuild(benchOf('uno'), firmware, 'interpreter', true);
    expect(on.fault).toBe(off.fault);
    expect(on.timeMs).toBe(off.timeMs);
  });
});
