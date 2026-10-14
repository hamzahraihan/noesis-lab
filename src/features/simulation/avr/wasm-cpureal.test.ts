import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

interface WasmCpuExports {
  flash_base(): number;
  reset_cpu(): void;
  get_reg(i: number): number;
  set_reg(i: number, v: number): void;
  get_pc(): number;
  get_cycles(): number;
  step(n: number): number;
  memory: WebAssembly.Memory;
}

async function instantiate(): Promise<WasmCpuExports> {
  execSync('sh scripts/build-avr-wasm.sh', { stdio: 'pipe' });
  const bytes = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
  const mod = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(mod, {});
  return instance.exports as unknown as WasmCpuExports;
}

function flashView(exports: WasmCpuExports, len = 8): Uint16Array {
  return new Uint16Array(exports.memory.buffer, exports.flash_base(), len);
}

describe('wasm cpu state', () => {
  it('resets registers and steps NOPs without trapping', async () => {
    const exports = await instantiate();
    exports.reset_cpu();
    expect(exports.get_pc()).toBe(0);
    expect(exports.get_cycles()).toBe(0);
    expect(exports.get_reg(16)).toBe(0);
    exports.set_reg(16, 0xab);
    expect(exports.get_reg(16)).toBe(0xab);
    exports.reset_cpu();
    expect(exports.get_reg(16)).toBe(0);
    const flash = flashView(exports, 4);
    flash[0] = 0x0000;
    flash[1] = 0x0000;
    expect(exports.step(2)).toBe(-1);
    expect(exports.get_pc()).toBe(2);
    expect(exports.get_cycles()).toBe(2);
  }, 120000);

  it('matches avr8js on LDI/NOP/RJMP programs', async () => {
    const exports = await instantiate();
    const { CPU, avrInstruction } = await import('avr8js');
    const runWasm = (
      words: number[],
      cycles: number,
    ): { pc: number; r16: number; cycles: number } => {
      exports.reset_cpu();
      flashView(exports, 8).set(words);
      expect(exports.step(cycles)).toBe(-1);
      return { pc: exports.get_pc(), r16: exports.get_reg(16), cycles: exports.get_cycles() };
    };
    const runJs = (
      words: number[],
      cycles: number,
    ): { pc: number; r16: number; cycles: number } => {
      // Pad: avr8js wraps pc modulo progMem.length, so the reference
      // program needs trailing NOPs to avoid wrapping in the test window.
      const padded = new Uint16Array(8);
      padded.set(words);
      const cpu = new CPU(padded);
      let remaining = cycles;
      while (remaining > 0) {
        const before = cpu.cycles;
        avrInstruction(cpu);
        cpu.tick();
        remaining -= cpu.cycles - before;
      }
      return { pc: cpu.pc, r16: cpu.data[16] as number, cycles: cpu.cycles };
    };
    expect(runWasm([0xe401, 0x0000], 2)).toEqual(runJs([0xe401, 0x0000], 2));
    expect(runWasm([0xe401, 0x0000], 2).r16).toBe(0x41);
    expect(runWasm([0x0000, 0xcfff], 3)).toEqual(runJs([0x0000, 0xcfff], 3));
    expect(runWasm([0x0000, 0xcfff], 3).pc).toBe(1);
  }, 120000);

  it('traps unknown opcodes by returning the pc', async () => {
    const exports = await instantiate();
    exports.reset_cpu();
    flashView(exports, 4)[0] = 0xffff;
    expect(exports.step(1)).toBe(0);
    expect(exports.get_pc()).toBe(0);
    expect(exports.get_cycles()).toBe(0);
  }, 120000);
});
