import { describe, expect, it } from 'vitest';
import { runAttached, type AttachedShadow, type AttachedWasm } from './wasm-core';

describe('trap adapter', () => {
  it('resumes past traps until the shadow stops', () => {
    let calls = 0;
    const shadow: AttachedShadow = {
      stepOnce: () => {
        calls += 1;
        return calls < 3;
      },
      readState: () => ({ regs: [], pc: 0, sreg: 0 }),
      writeState: () => {},
    };
    const regs = new Array(32).fill(0);
    const wasm: AttachedWasm = {
      step: () => 0,
      getPc: () => 0,
      setPc: () => {},
      getReg: (i: number) => regs[i] ?? 0,
      setReg: (i: number, v: number) => {
        regs[i] = v & 0xff;
      },
      getSreg: () => 0,
      setSreg: () => {},
    };
    const r = runAttached(wasm, shadow, 10);
    expect(r.traps).toBe(3);
    expect(calls).toBe(3);
  });
});
