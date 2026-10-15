/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CPU, avrInstruction } from 'avr8js';

function encodeAdd(rd: number, rr: number): number {
  return (
    0x0c00 |
    (((rr >> 4) & 1) << 9) |
    (((rd >> 4) & 1) << 8) |
    ((rd & 0x0f) << 4) |
    (rr & 0x0f)
  );
}

interface AddWasmExports {
  flash_base(): number;
  reset_cpu(): void;
  get_reg(i: number): number;
  set_reg(i: number, v: number): void;
  get_pc(): number;
  get_sreg(): number;
  get_cycles(): number;
  step(n: number): number;
  memory: WebAssembly.Memory;
}

async function instantiate(): Promise<AddWasmExports> {
  const bytes = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes), {});
  return instance.exports as unknown as AddWasmExports;
}

function avr8jsAdd(rd: number, rr: number, a: number, b: number) {
  const cpu = new CPU(new Uint16Array([encodeAdd(rd, rr), 0x0000]));
  cpu.data[rd] = a & 0xff;
  cpu.data[rr] = b & 0xff;
  avrInstruction(cpu);
  cpu.tick();
  const regs: number[] = [];
  for (let i = 0; i < 32; i++) regs.push(cpu.data[i] & 0xff);
  return { regs, pc: cpu.pc, sreg: cpu.data[0x5f] & 0xff, cycles: cpu.cycles };
}

async function wasmAdd(ex: AddWasmExports, rd: number, rr: number, a: number, b: number) {
  ex.reset_cpu();
  new Uint16Array(ex.memory.buffer, ex.flash_base(), 2).set([encodeAdd(rd, rr), 0x0000]);
  ex.set_reg(rd, a);
  ex.set_reg(rr, b);
  const trap = ex.step(1);
  const regs: number[] = [];
  for (let i = 0; i < 32; i++) regs.push(ex.get_reg(i) & 0xff);
  return { trap, regs, pc: ex.get_pc(), sreg: ex.get_sreg() & 0xff, cycles: ex.get_cycles() };
}

describe('sreg sync via ADD', () => {
  it('executes ADD in Wasm (no trap) with SREG equal to avr8js', async () => {
    const ex = await instantiate();
    const ref = avr8jsAdd(16, 17, 0x05, 0x03);
    const got = await wasmAdd(ex, 16, 17, 0x05, 0x03);
    expect(got.trap, 'ADD executes in Wasm instead of trapping').toBe(-1);
    expect(got.regs).toEqual(ref.regs);
    expect(got.pc).toBe(ref.pc);
    expect(got.cycles).toBe(ref.cycles);
    expect(got.sreg).toBe(ref.sreg);
  });

  it('matches avr8js on SREG corners', async () => {
    const ex = await instantiate();
    const corners: Array<[number, number, number, number, string]> = [
      [0, 1, 0xff, 0x01, 'carry+zero'],
      [2, 3, 0x00, 0x00, 'zero'],
      [4, 5, 0x7f, 0x01, 'overflow+negative'],
      [6, 7, 0x0f, 0x01, 'half-carry'],
      [16, 17, 0x80, 0x80, 'carry+overflow'],
      [24, 25, 0x01, 0xff, 'carry'],
    ];
    for (const [rd, rr, a, b, name] of corners) {
      const ref = avr8jsAdd(rd, rr, a, b);
      const got = await wasmAdd(ex, rd, rr, a, b);
      expect(got.trap, `${name}: no trap`).toBe(-1);
      expect(got.regs[rd], `${name}: Rd`).toBe(ref.regs[rd]);
      expect(got.sreg, `${name}: SREG`).toBe(ref.sreg);
      expect(got.pc, `${name}: PC`).toBe(ref.pc);
      expect(got.cycles, `${name}: cycles`).toBe(ref.cycles);
    }
  });

  it('matches avr8js on randomized operands', async () => {
    const ex = await instantiate();
    let seed = 0x12345678;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed & 0xff;
    };
    for (let k = 0; k < 25; k++) {
      const rd = rnd() & 0x1f;
      let rr = rnd() & 0x1f;
      if (rr === rd) rr = (rr + 1) & 0x1f;
      const a = rnd();
      const b = rnd();
      const ref = avr8jsAdd(rd, rr, a, b);
      const got = await wasmAdd(ex, rd, rr, a, b);
      expect(got.trap, `case ${k}: no trap`).toBe(-1);
      expect(got.regs, `case ${k}: regs`).toEqual(ref.regs);
      expect(got.sreg, `case ${k}: SREG`).toBe(ref.sreg);
    }
  });
});
