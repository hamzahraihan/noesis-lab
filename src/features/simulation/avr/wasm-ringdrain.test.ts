import { describe, expect, it } from 'vitest';
import { drainWasmEvents, samplePinsToWasm, WASM_LAYOUT } from './wasm-core';

function ringMemory(events: Array<[number, boolean]>): ArrayBuffer {
  const buf = new ArrayBuffer(40960);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  events.forEach(([gpio, high], i) => {
    bytes[WASM_LAYOUT.eventBase + (i % 64) * 2] = gpio;
    bytes[WASM_LAYOUT.eventBase + (i % 64) * 2 + 1] = high ? 1 : 0;
  });
  view.setInt32(WASM_LAYOUT.headOff, events.length, true);
  view.setInt32(WASM_LAYOUT.tailOff, Math.max(0, events.length - 64), true);
  return buf;
}

describe('ring drain', () => {
  it('drains oldest-first with the reported count', () => {
    const drained = drainWasmEvents(
      ringMemory([
        [13, true],
        [12, false],
      ]),
    );
    expect(drained).toEqual([
      { gpio: 13, high: true },
      { gpio: 12, high: false },
    ]);
  });

  it('samples a full pin map into the pin region', () => {
    const buf = new ArrayBuffer(40960);
    samplePinsToWasm(
      buf,
      new Map([
        [13, true],
        [0, false],
      ]),
    );
    const bytes = new Uint8Array(buf);
    expect(bytes[WASM_LAYOUT.pinBase + 13]).toBe(1);
    expect(bytes[WASM_LAYOUT.pinBase + 0]).toBe(0);
  });

  it('clamps a corrupt-large backlog to the ring cap', () => {
    const buf = new ArrayBuffer(40960);
    const view = new DataView(buf);
    view.setInt32(WASM_LAYOUT.headOff, 1000, true);
    view.setInt32(WASM_LAYOUT.tailOff, 0, true);
    expect(drainWasmEvents(buf).length).toBeLessThanOrEqual(64);
  });

  it('advances TAIL so a second drain returns nothing', () => {
    const buf = ringMemory([
      [13, true],
      [12, false],
    ]);
    expect(drainWasmEvents(buf)).toHaveLength(2);
    expect(drainWasmEvents(buf)).toEqual([]);
    expect(new DataView(buf).getInt32(WASM_LAYOUT.tailOff, true)).toBe(2);
  });

  it('advances TAIL partially when maxEvents caps the drain', () => {
    const buf = ringMemory([
      [13, true],
      [12, false],
    ]);
    expect(drainWasmEvents(buf, 1)).toEqual([{ gpio: 13, high: true }]);
    expect(new DataView(buf).getInt32(WASM_LAYOUT.tailOff, true)).toBe(1);
    expect(drainWasmEvents(buf)).toEqual([{ gpio: 12, high: false }]);
  });
});
