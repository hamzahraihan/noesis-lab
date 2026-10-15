import { describe, expect, it, vi } from 'vitest';
import { createWorkerClient } from '@/features/bench/simulations/worker-client';
import { createSimCore } from './core';
import { boardOption } from '@/features/learn/boardRegistry';

describe('wasm fallback cause', () => {
  it('reports version mismatch through the fallback path', () => {
    const onFallback = vi.fn();
    const client = createWorkerClient({
      board: { id: 'uno' } as never,
      onFallback,
      forceNoWorker: true,
    });
    expect(client).toBeNull();
    expect(onFallback).toHaveBeenCalledOnce();
    expect(String(onFallback.mock.calls[0]?.[0] ?? '')).not.toBe('');
  });

  it('rebuilds cleanly with the flag on and no module present', () => {
    const core = createSimCore(boardOption('uno').make());
    const bench = { parts: [], wires: [], terminals: [], revision: 0 };
    const firmware = {
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
    };
    core.rebuild(bench as never, firmware as never, 'interpreter', true);
    expect(core.fault).toBeNull();
  });
});
