import { describe, expect, it } from 'vitest';
import { drainWasmEvents, samplePinsToWasm } from './wasm-core';

function ringMemory(events: Array<[number, boolean]>): ArrayBuffer {
  const buf = new ArrayBuffer(2048);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  events.forEach(([gpio, high], i) => {
    bytes[1076 + (i % 64) * 2] = gpio;
    bytes[1076 + (i % 64) * 2 + 1] = high ? 1 : 0;
  });
  view.setInt32(1204, events.length, true);
  view.setInt32(1208, Math.max(0, events.length - 64), true);
  return buf;
}

describe('ring drain', () => {
  it('drains oldest-first with the reported count', () => {
    const drained = drainWasmEvents(ringMemory([[13, true], [12, false]]));
    expect(drained).toEqual([
      { gpio: 13, high: true },
      { gpio: 12, high: false },
    ]);
  });

  it('samples a full pin map into the pin region', () => {
    const buf = new ArrayBuffer(2048);
    samplePinsToWasm(buf, new Map([[13, true], [0, false]]));
    const bytes = new Uint8Array(buf);
    expect(bytes[1056 + 13]).toBe(1);
    expect(bytes[1056 + 0]).toBe(0);
  });
});
