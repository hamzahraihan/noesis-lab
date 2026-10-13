import { describe, expect, it } from 'vitest';
import { AvrBackend } from './core';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';

describe('wasm backend fallback', () => {
  it('steps blink without fault when wasm missing', () => {
    const mcu = new McuRuntime(arduinoUnoR3());
    const backend = new AvrBackend(new Uint16Array(1024), {
      mcu,
      nowMs: () => 0,
      readPin: () => false,
      onSettle: () => {},
      serial: { serialWrite: () => {} },
      i2c: { writeByte: () => true, readByte: () => 0xff },
    });
    backend.step(16);
    expect(backend.fault).toBeNull();
  });
});
