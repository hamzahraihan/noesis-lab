import { describe, expect, it } from 'vitest';
import { AvrBackend } from './core';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';

function backend(): AvrBackend {
  const mcu = new McuRuntime(arduinoUnoR3());
  return new AvrBackend(new Uint16Array([0xe401, 0x0000]), {
    mcu,
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
}

describe('shadow single-step', () => {
  it('advances one LDI per call and reports no throw', () => {
    const avr = backend();
    expect(avr.stepShadowOnce()).toBe(true);
    expect(avr.stepShadowOnce()).toBe(true);
    expect(avr.fault).toBeNull();
  });
});
