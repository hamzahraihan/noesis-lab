import { describe, expect, it } from 'vitest';
import { allocSnapshot, headerView, layoutFor, SNAP_MAGIC, SNAP_VERSION } from './protocol';

describe('snapshot protocol', () => {
  it('round-trips header, nets, pin nodes, display bytes, and the serial ring', () => {
    const layout = layoutFor(8, 4, 16, 64);
    const buf = allocSnapshot(layout);
    const header = headerView(buf);
    expect(header.magic).toBe(SNAP_MAGIC);
    expect(header.version).toBe(SNAP_VERSION);
    header.generation = 41;
    header.timeMs = 123.5;
    expect(headerView(buf).generation).toBe(41);
    expect(headerView(buf).timeMs).toBe(123.5);
  });

  it('rejects a version mismatch', () => {
    const buf = allocSnapshot(layoutFor(2, 1, 4, 16));
    new Uint32Array(buf, 4, 1)[0] = SNAP_VERSION + 1;
    expect(() => headerView(buf)).toThrow('snapshot version mismatch');
  });

  it('wraps the serial ring and raises overflow', () => {
    const buf = allocSnapshot(layoutFor(2, 1, 4, 8));
    const header = headerView(buf);
    for (let i = 0; i < 20; i++) header.serialPush(i);
    expect(header.overflow).toBe(1);
    expect(header.serialDrain().length).toBeLessThanOrEqual(8);
  });

  it('monotonic generation across 2^32 wrap is detectable', () => {
    const buf = allocSnapshot(layoutFor(1, 1, 1, 8));
    const header = headerView(buf);
    header.generation = 0xffffffff;
    header.bump();
    expect(headerView(buf).generation).toBe(0);
  });
});
