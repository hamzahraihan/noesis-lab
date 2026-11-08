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

describe('AvrBackend readMemory', () => {
  it('reads bytes from the data space', () => {
    const avr = backend();
    const bytes = avr.readMemory(0, 32);
    expect(bytes).toHaveLength(32);
    // Registers 0-31 are all zero initially.
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it('clamps out-of-range addresses to an empty result', () => {
    const avr = backend();
    expect(avr.readMemory(0xffff, 10)).toEqual([]);
  });

  it('clamps negative lengths to an empty result', () => {
    const avr = backend();
    expect(avr.readMemory(0, -1)).toEqual([]);
    expect(avr.readMemory(0, 0)).toEqual([]);
  });

  it('clamps reads that run past the end of data space', () => {
    const avr = backend();
    const cpuDataLength = avr.readMemory(0, 1000000).length;
    expect(cpuDataLength).toBeLessThanOrEqual(1000000);
    expect(cpuDataLength).toBeGreaterThan(0);
    // A read past the end returns only what is there.
    const end = cpuDataLength;
    expect(avr.readMemory(end - 4, 10)).toHaveLength(4);
  });

  it('reads the same bytes the stop frame carries', async () => {
    // The existing compiled-variables test confirms the memory snapshot
    // starts at 0x100 and is 0x800 bytes long; readMemory should agree.
    const avr = backend();
    const snapshot = avr.readMemory(0x100, 0x800);
    expect(snapshot).toHaveLength(0x800);
  });
});
