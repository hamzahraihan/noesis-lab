/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
import { describe, expect, it } from 'vitest';
import { AvrBackend } from './core';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';
import { runAttached } from './wasm-core';
import { coverage } from './wasm/coverage';
import rankJson from './wasm/op-rank.json';

function jsBackend(): AvrBackend {
  const mcu = new McuRuntime(arduinoUnoR3());
  return new AvrBackend(new Uint16Array([0xe401, 0x0000, 0x0000]), {
    mcu,
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
}

describe('dual path', () => {
  it('blink leg: attached run matches JS step counts with logged traps', () => {
    const avr = jsBackend();
    let shadowCalls = 0;
    const shadow = {
      stepOnce: () => {
        shadowCalls += 1;
        avr.stepShadowOnce();
        return true;
      },
      readState: () => ({ regs: [] as number[], pc: 0, sreg: 0 }),
      writeState: () => {},
    };
    const wasm = {
      step: () => 0,
      getPc: () => 0,
      setPc: () => {},
      getReg: () => 0,
      setReg: () => {},
      getSreg: () => 0,
      setSreg: () => {},
    };
    const r = runAttached(wasm, shadow, 4);
    expect(r.traps).toBe(4);
    expect(shadowCalls).toBe(4);
    const rank = rankJson as Array<{ opcode: string; count: number }>;
    const total = rank.reduce((sum, entry) => sum + entry.count, 0);
    const ported = new Set([rank[0].opcode]);
    const c = coverage(rank, ported);
    expect(c.covered).toBe(rank[0].count);
    expect(c.rate).toBe(rank[0].count / total);
  });
});
