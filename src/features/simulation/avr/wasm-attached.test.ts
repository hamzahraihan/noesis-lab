import { describe, expect, it } from 'vitest';
import { runAttached, type AttachedWasm } from './wasm-core';

describe('attached run', () => {
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
    };
    const shadow = {
      stepOnce: () => true,
      readState: () => ({ regs: [...regs], pc, sreg }),
      writeState: () => {},
    };
    regs[0] = 0x41;
    sreg = 0x02;
    const r = runAttached(wasm, shadow, 5);
    expect(r.traps).toBe(1);
    expect(wasm.getReg(0)).toBe(0x41);
    expect(wasm.getPc()).toBe(0);
    expect(wasm.getSreg()).toBe(0x02);
  });
});
