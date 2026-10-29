import { describe, expect, it } from 'vitest';
import { AvrBackend } from './core';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';

function makeBackend(): AvrBackend {
  return new AvrBackend(new Uint16Array(1024), {
    mcu: new McuRuntime(arduinoUnoR3()),
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
}

/**
 * A wasm core whose flash image ends at word 512 and whose PC sits on that
 * boundary: every call traps at an address Wasm can never execute.
 *
 * That is the shape the truncated-flash regression took. The dispatch loop
 * must notice the trap PC is outside the module's flash and hand the slice to
 * the shadow instead of spending its 10000x trap allowance round-tripping.
 */
describe('wasm trap outside its flash image', () => {
  it('finishes a frame on the shadow instead of spinning', () => {
    const backend = makeBackend();
    backend.attachWasm({
      step: () => 512,
      getInstructions: () => 0,
      getCycles: () => 0,
      setCycles: () => {},
      getFlashCapacity: () => 512,
      getPc: () => 512,
      setPc: () => {},
      getReg: () => 0,
      setReg: () => {},
      getSreg: () => 0,
      setSreg: () => {},
      getSp: () => 0,
      setSp: () => {},
    } as never);

    const t0 = performance.now();
    backend.step(16);
    const wallMs = performance.now() - t0;

    expect(wallMs).toBeLessThan(1000);
    expect(backend.cycles).toBeGreaterThan(0);
    expect(backend.fault).toBeNull();
  });
});
