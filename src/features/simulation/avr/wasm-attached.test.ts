import { describe, expect, it } from 'vitest';
import { runAttached, type AttachedWasm } from './wasm-core';

describe('wasm-visible preservation', () => {
  it('syncs all 32 registers plus sreg plus pc both ways', async () => {
    const regs = new Array(32).fill(0);
    let pc = 0;
    let sreg = 0;
    // NOTE (test-fake deviation from brief Step 1): the brief's `step: () => pc`
    // traps on every call, so the driver loop would trap 5 times for cycles=5
    // instead of the asserted traps=1. This fake traps once at pc 0 (per the
    // brief's own trace narrative) then reports a clean run (-1), exercising
    // both the trap+sync path and the clean-exit path.
    let trapped = false;
    const wasm: AttachedWasm = {
      step: () => {
        if (!trapped) {
          trapped = true;
          return pc;
        }
        return -1;
      },
      getPc: () => pc,
      setPc: (v: number) => {
        pc = v;
      },
      getReg: (i: number) => regs[i] ?? 0,
      setReg: (i: number, v: number) => {
        regs[i] = v & 0xff;
      },
      getSreg: () => sreg,
      setSreg: (v: number) => {
        sreg = v & 0xff;
      },
      getCycles: () => 0,
      setCycles: () => {},
      getInstructions: () => 0,
    };
    // DIVERGENT shadow: wasm regs start zeroed, shadow carries regs[i]=i,
    // pc 5, sreg 3, so the post-run assertions prove wasm-visible state
    // was overwritten from the shadow (not an echo of its own state).
    const shadowRegs = Array.from({ length: 32 }, (_, i) => i);
    const shadow = {
      stepOnce: () => true,
      readState: () => ({ regs: [...shadowRegs], pc: 5, sreg: 3 }),
      writeState: () => {},
    };
    const r = runAttached(wasm, shadow, 5);
    expect(r.traps).toBe(1);
    for (let i = 0; i < 32; i++) expect(wasm.getReg(i)).toBe(i);
    expect(wasm.getPc()).toBe(5);
    expect(wasm.getSreg()).toBe(3);
  });
});
