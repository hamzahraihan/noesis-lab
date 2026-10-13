import { describe, expect, it } from 'vitest';
import { AvrBackend } from './core';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';

describe('avr fault prefix', () => {
  it('maps a throwing pin hook to fault with PC/cycles prefix', () => {
    // The Timer1 per-tick sampler calls readPinRaw (= readPin here) on every
    // cpu.tick(), which runs inside step()'s try — so once armed, this fires on
    // the first cycle, deterministically. (Two paths that canNOT drive the
    // fault: onSettle sits outside the try and must propagate, and a [0xffff]
    // flash is silent — avr8js treats undecoded opcodes as NOPs and never
    // throws, verified against avr8js@0.21.1 sources and empirically.)
    let armed = false;
    const backend = new AvrBackend(new Uint16Array(1024), {
      mcu: new McuRuntime(arduinoUnoR3()),
      nowMs: () => 0,
      readPin: () => {
        if (armed) throw new Error('pin boom');
        return false;
      },
      onSettle: () => {},
      serial: { serialWrite: () => {} },
      i2c: { writeByte: () => true, readByte: () => 0xff },
    });
    armed = true;
    backend.step(1);
    expect(backend.fault ?? '').toMatch(/^core fault at PC=/);
    expect(backend.fault ?? '').toContain('pin boom');
  });
});

describe('wasm seam unwired', () => {
  it('never attaches a wasm core through the public API', () => {
    // Pins the Task 4 routing branch unreachable: no setter exists, so the
    // private field stays null across construct/step/reset and the JS fallback
    // always runs. The wiring task must update this test when it adds the
    // injection point.
    const backend = new AvrBackend(new Uint16Array(1024), {
      mcu: new McuRuntime(arduinoUnoR3()),
      nowMs: () => 0,
      readPin: () => false,
      onSettle: () => {},
      serial: { serialWrite: () => {} },
      i2c: { writeByte: () => true, readByte: () => 0xff },
    });
    const seam = backend as unknown as { wasm: unknown };
    expect(seam.wasm).toBeNull();
    backend.step(1);
    expect(seam.wasm).toBeNull();
    backend.reset();
    expect(seam.wasm).toBeNull();
  });
});
