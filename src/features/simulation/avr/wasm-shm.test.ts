import { describe, expect, it } from 'vitest';
import { attachShm, createShm } from './wasm/shm';

describe('wasm shm', () => {
  it('samples pins and drains queued edges in order', () => {
    const shm = createShm();
    shm.samplePin(13, true);
    shm.queueEdge(13, true);
    shm.queueEdge(13, false);
    expect(shm.readPin(13)).toBe(true);
    expect(shm.drainEvents()).toEqual([
      { gpio: 13, high: true },
      { gpio: 13, high: false },
    ]);
    expect(shm.drainEvents()).toEqual([]);
  });

  it('attaches to a core without throwing (fallback-safe)', () => {
    expect(() => attachShm(null, createShm())).not.toThrow();
  });
});
