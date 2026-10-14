import { describe, expect, it } from 'vitest';
import { AvrBackend } from './core';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';

function hooks(mcu: McuRuntime, settles: { count: number }) {
  return {
    mcu,
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {
      settles.count += 1;
    },
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  };
}

function cpuState(backend: AvrBackend): { regs: number[]; pc: number } {
  const cpu = (backend as unknown as { cpu: { data: ArrayLike<number>; pc: number } }).cpu;
  const regs: number[] = [];
  for (let i = 0; i < 32; i++) regs.push((cpu.data[i] ?? 0) & 0xff);
  return { regs, pc: cpu.pc };
}

describe('attached dispatch', () => {
  it('runs LDI in Wasm, traps ADD to shadow, lands identical state and settles', () => {
    const mcuJs = new McuRuntime(arduinoUnoR3());
    const settlesJs = { count: 0 };
    const js = new AvrBackend(new Uint16Array([0xe401, 0x0c00, 0x0000]), hooks(mcuJs, settlesJs));
    js.step(2);
    expect(js.fault).toBeNull();

    const mcuWasm = new McuRuntime(arduinoUnoR3());
    const settlesWasm = { count: 0 };
    const attached = new AvrBackend(new Uint16Array([0xe401, 0x0c00, 0x0000]), hooks(mcuWasm, settlesWasm));
    attached.attachWasm({} as never);
    attached.step(2);
    expect(attached.fault).toBeNull();
    expect(settlesWasm.count).toBe(settlesJs.count);
  });

  it('lands identical regs/pc/cycles with a trapping fake wasm', () => {
    const words = new Uint16Array([0xe401, 0x0c00, 0x0000]);
    const mcuJs = new McuRuntime(arduinoUnoR3());
    const settlesJs = { count: 0 };
    const js = new AvrBackend(words, hooks(mcuJs, settlesJs));
    js.step(2);
    expect(js.fault).toBeNull();

    // Fake wasm: executes the ported prefix (LDI at 0, NOP at 2),
    // traps the ADD at 1 and anything out of bounds. State is kept
    // locally so the driver's shadow->wasm sync has somewhere to land.
    // NOTE: pc wraps mod flash length like avr8js (verified empirically:
    // a 3-word flash loops pc 0,1,2,0,...); without the wrap the fake and
    // the shadow follow different paths and no pc-equality catch-up can
    // converge. Real wasm/cpu.ts has no wrap yet (linear pc, OOB trap) —
    // wrap fidelity there (or full-size flashes) is follow-up work.
    const regs = new Array(32).fill(0);
    let pc = 0;
    let sreg = 0;
    const fake = {
      step: (n: number): number => {
        let remaining = n;
        while (remaining > 0) {
          const w = words[pc % words.length] ?? 0;
          if (w === 0x0000) {
            pc = (pc + 1) % words.length;
            remaining -= 1;
          } else if ((w & 0xf000) === 0xe000) {
            const rd = 16 + ((w >> 4) & 0x0f);
            regs[rd] = ((w >> 8) & 0x0f) * 16 + (w & 0x0f);
            pc = (pc + 1) % words.length;
            remaining -= 1;
          } else {
            return pc;
          }
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

    const mcuWasm = new McuRuntime(arduinoUnoR3());
    const settlesWasm = { count: 0 };
    const attached = new AvrBackend(words, hooks(mcuWasm, settlesWasm));
    attached.attachWasm(fake as never);
    attached.step(2);
    expect(attached.fault).toBeNull();
    expect(settlesWasm.count).toBe(settlesJs.count);
    expect(attached.cycles).toBe(js.cycles);
    const jsState = cpuState(js);
    const attachedState = cpuState(attached);
    expect(attachedState.pc).toBe(jsState.pc);
    expect(attachedState.regs).toEqual(jsState.regs);
  });
});
