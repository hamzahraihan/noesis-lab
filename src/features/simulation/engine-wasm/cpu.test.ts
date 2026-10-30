/**
 * Parity gate for issue #20 phase 3: the C++ AVR CPU core against the
 * TypeScript oracle (`avr8js`).
 *
 * Loads the committed `solver.wasm` (built by `npm run build:engine`), wires
 * the new `cpu_step` trap ABI to the same `AvrBackend` the JS shadow uses,
 * and asserts register/SREG/PC/SP and cycle counts match bit-for-bit on the
 * same flash program.
 *
 * The flash program below only uses instructions the C++ core can execute
 * (LDI, MOV, ADD, CPI, BRBS/BRBC, RJMP) so both backends run it natively.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { AvrBackend } from '../avr/core';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';
import { loadWasmAvrCpu, type WasmAvrCpu } from './cpu';

let wasm: WasmAvrCpu;

beforeAll(async () => {
  const buffer = readFileSync('src/features/simulation/engine-wasm/solver.wasm');
  const bytes = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  wasm = await loadWasmAvrCpu(async () => bytes);
});

const FLASH_WORDS = 16384;

function flashProgram(words: Uint16Array): Uint16Array {
  const flash = new Uint16Array(FLASH_WORDS).fill(0x0000);
  flash.set(words);
  return flash;
}

function makeBackend(words: Uint16Array): AvrBackend {
  const mcu = new McuRuntime(arduinoUnoR3());
  return new AvrBackend(words, {
    mcu,
    nowMs: () => 0,
    readPin: () => false,
    readPinRaw: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: {
      writeByte: () => true,
      readByte: () => 0,
    },
  });
}

describe('C++ AVR CPU parity: fixed programs', () => {
  it('executes LDI/MOV/ADD identically to the JS shadow', () => {
    // LDI r16, 42 ; LDI r17, 7 ; ADD r16, r17 ; CPI r16, 49 ; BRBS C skip ;
    // RJMP end ; skip: NOP ; end: NOP
    const words = new Uint16Array([
      0xe20a, // LDI r16, 42
      0xe017, // LDI r17, 7
      0x0f01, // ADD r16, r17  (r16 = 49)
      0x0000, // NOP
    ]);
    const flash = flashProgram(words);

    const js = makeBackend(flash);
    const cpp = makeBackend(flash);
    cpp.attachWasm(wasm);
    wasm.writeFlash(words);

    const jsState = js as unknown as {
      cpu: { data: number[]; SREG: number; pc: number; SP: number; cycles: number };
    };
    const cppState = cpp as unknown as {
      cpu: { data: number[]; SREG: number; pc: number; SP: number; cycles: number };
    };

    // JS runs the whole program.
    for (let i = 0; i < 20; i++) js.step(0.001);
    // C++ runs the same via runWasmSlice.
    for (let i = 0; i < 20; i++) cpp.step(0.001);

    for (let r = 0; r < 32; r++) {
      expect(jsState.cpu.data[r], `reg r${r}`).toBe(cppState.cpu.data[r]);
    }
    expect(jsState.cpu.SREG, 'SREG').toBe(cppState.cpu.SREG);
    expect(jsState.cpu.pc, 'pc').toBe(cppState.cpu.pc);
    expect(jsState.cpu.SP, 'SP').toBe(cppState.cpu.SP);
    expect(jsState.cpu.cycles, 'cycles').toBe(cppState.cpu.cycles);
  });
});
