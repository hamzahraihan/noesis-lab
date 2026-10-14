import { describe, expect, it } from 'vitest';
import { loadWasmCore, pullWasmState, readShadowState } from './wasm-core';

describe('wasm-core seam', () => {
  it('returns null (fallback) when no module built yet', async () => {
    await expect(loadWasmCore()).resolves.toBeNull();
  });
});

describe('wasm sync helpers', () => {
  it('pullWasmState lands regs/pc/sreg on the attached core', () => {
    const regs = new Array(32).fill(0);
    let pc = -1;
    let sreg = -1;
    const wasm = {
      step: () => -1,
      getPc: () => pc,
      setPc: (v: number) => {
        pc = v;
      },
      getReg: (i: number) => regs[i] ?? 0,
      setReg: (i: number, v: number) => {
        regs[i] = v;
      },
      getSreg: () => sreg,
      setSreg: (v: number) => {
        sreg = v;
      },
    };
    const shadow = { regs: Array.from({ length: 32 }, (_, i) => i), pc: 7, sreg: 0xd8 };
    pullWasmState(wasm, shadow);
    expect(regs).toEqual(shadow.regs);
    expect(pc).toBe(7);
    expect(sreg).toBe(0xd8);
  });

  it('readShadowState mirrors regs/pc/SREG off the shadow cpu', () => {
    const data = new Array(256).fill(0);
    data[3] = 0x1ff;
    data[0x5f] = 0x1c2;
    const state = readShadowState({ data, pc: 5 });
    expect(state.regs[3]).toBe(0xff);
    expect(state.regs).toHaveLength(32);
    expect(state.pc).toBe(5);
    expect(state.sreg).toBe(0xc2);
  });
});
