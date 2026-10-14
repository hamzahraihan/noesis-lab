import { describe, expect, it } from 'vitest';
import { createShm } from './wasm/shm';
import { drainPortEvents, syncPins } from './wasm-core';

describe('bridge sync', () => {
  it('samples all levels then drains edges in order', () => {
    const shm = createShm();
    syncPins(shm, new Map([[13, true], [12, false]]));
    expect(shm.readPin(13)).toBe(true);
    expect(shm.readPin(12)).toBe(false);
    shm.queueEdge(13, true);
    const applied: Array<[number, boolean]> = [];
    const count = drainPortEvents(shm, (gpio, high) => {
      applied.push([gpio, high]);
    });
    expect(count).toBe(1);
    expect(applied).toEqual([[13, true]]);
    expect(drainPortEvents(shm, () => {})).toBe(0);
  });

  it('clears attached wasm state on reset', async () => {
    const { AvrBackend } = await import('./core');
    const { McuRuntime } = await import('@/features/simulation/mcu');
    const { arduinoUnoR3 } = await import('@/features/parts');
    const mcu = new McuRuntime(arduinoUnoR3());
    const backend = new AvrBackend(new Uint16Array(1024), {
      mcu,
      nowMs: () => 0,
      readPin: () => false,
      onSettle: () => {},
      serial: { serialWrite: () => {} },
      i2c: { writeByte: () => true, readByte: () => 0xff },
    });
    let cleared = 0;
    backend.attachWasmReset(() => {
      cleared += 1;
    });
    backend.reset();
    expect(cleared).toBe(1);
  });
});
