import { describe, expect, it } from 'vitest';
import { AvrBackend } from './core';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';

describe('attachWasm', () => {
  it('keeps the JS path when attached null', () => {
    const mcu = new McuRuntime(arduinoUnoR3());
    const backend = new AvrBackend(new Uint16Array(1024), {
      mcu,
      nowMs: () => 0,
      readPin: () => false,
      onSettle: () => {},
      serial: { serialWrite: () => {} },
      i2c: { writeByte: () => true, readByte: () => 0xff },
    });
    backend.attachWasm(null);
    backend.step(1);
    expect(backend.fault).toBeNull();
  });
});
