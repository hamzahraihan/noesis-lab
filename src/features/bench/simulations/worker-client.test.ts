import { describe, expect, it, vi } from 'vitest';
import { allocSnapshot, headerView, layoutFor } from '@/features/simulation/sim-worker/protocol';
import { createWorkerClient, ingestSnapshot, type MirrorState } from './worker-client';

function blankMirror(): MirrorState {
  return { layout: null, pinVolts: new Map(), values: new Map(), colon: new Map(), serial: [] as string[] };
}

describe('worker client fallback', () => {
  it('falls back when workers are unavailable', () => {
    const onFallback = vi.fn();
    const client = createWorkerClient({ board: { id: 'uno' } as never, onFallback, forceNoWorker: true });
    expect(client).toBeNull();
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it('rebinds across an SHM realloc without mixing layouts', () => {
    const state = blankMirror();
    const a = allocSnapshot(layoutFor(4, 2, 8, 16));
    headerView(a).generation = 1;
    expect(ingestSnapshot(state, a)).toBe('ok');
    expect(ingestSnapshot(state, a)).toBe('stale');
    const b = allocSnapshot(layoutFor(9, 2, 8, 16));
    headerView(b).generation = 1;
    expect(ingestSnapshot(state, b)).toBe('reallocated');
    expect(ingestSnapshot(state, b)).toBe('stale');
  });
});
