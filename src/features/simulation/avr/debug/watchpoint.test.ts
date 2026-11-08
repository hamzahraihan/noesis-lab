import { describe, expect, it } from 'vitest';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts/boards';
import { AvrBackend } from '../core';

function backend(): AvrBackend {
  return new AvrBackend(new Uint16Array([]), {
    mcu: new McuRuntime(arduinoUnoR3()),
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
}

describe('AvrBackend watchpoints', () => {
  it('adds and removes a watchpoint', () => {
    const avr = backend();
    const id = avr.addWatchpoint(0x100, 1);
    expect(id).toBeGreaterThan(0);
    expect(avr.watchpointCount).toBe(1);

    expect(avr.removeWatchpoint(id)).toBe(true);
    expect(avr.watchpointCount).toBe(0);
    // Removing again returns false.
    expect(avr.removeWatchpoint(id)).toBe(false);
  });

  it('rejects out-of-range addresses', () => {
    const avr = backend();
    expect(avr.addWatchpoint(-1, 1)).toBe(-1);
    expect(avr.addWatchpoint(0xffff, 1)).toBe(-1);
    expect(avr.addWatchpoint(0, 0)).toBe(-1);
    expect(avr.watchpointCount).toBe(0);
  });

  it('clamps the size to the data space', () => {
    const avr = backend();
    const id = avr.addWatchpoint(0x100, 100000);
    expect(id).toBeGreaterThan(0);
    // The watchpoint is still one entry, even though the size was clamped.
    expect(avr.watchpointCount).toBe(1);
  });

  it('clears watchpoints on reset', () => {
    const avr = backend();
    avr.addWatchpoint(0x100, 1);
    avr.addWatchpoint(0x200, 2);
    expect(avr.watchpointCount).toBe(2);
    avr.reset();
    expect(avr.watchpointCount).toBe(0);
  });
});
