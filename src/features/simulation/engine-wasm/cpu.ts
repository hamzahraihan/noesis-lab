/**
 * WebAssembly bridge for the C++ AVR CPU core (issue #20, phase 3).
 *
 * The C++ core in `cpu.cpp` is freestanding wasm32 and mirrors the
 * TypeScript core in `../avr/wasm/cpu.ts`: fetch/decode/execute of
 * simple-instruction subset plus Timer0. Anything it cannot execute (I/O,
 * unsupported ports, stack, unported opcodes) traps by returning the
 * trapping PC; the host (`core.ts`) handles those instructions with the JS
 * shadow and resumes.
 *
 * ABI (mirrored in cpu.cpp; keep offsets/names in sync):
 *   cpu_step(uint32_t budget_cycles) -> int32_t   (-1 | trap pc)
 *   cpu_get_pc / cpu_set_pc
 *   cpu_get_reg / cpu_set_reg (i -> u8)
 *   cpu_get_sreg / cpu_set_sreg
 *   cpu_get_sp / cpu_set_sp
 *   cpu_get_cycles / cpu_set_cycles
 *   cpu_get_instructions
 *   cpu_get_flash_capacity
 *   cpu_get_flash_base
 *   cpu_reset
 *   cpu_write_pin / cpu_pin_level
 *   cpu_write_flash
 *
 * The TypeScript AVR core stays the default. This bridge exists so phase 3
 * can be exercised against the oracle, and so later phases have a CPU ABI to
 * extend rather than a second core to write.
 */

import { instantiateEngine, type EngineExports } from './engine';

/** Host-side handle to the attached C++ AVR core. */
export interface WasmAvrCpu {
  /** Run up to `budgetCycles` of instructions; -1 = consumed cleanly, else trap pc. */
  step(budgetCycles: number): number;
  getPc(): number;
  setPc(v: number): void;
  getReg(i: number): number;
  setReg(i: number, v: number): void;
  getSreg(): number;
  setSreg(v: number): void;
  getSp(): number;
  setSp(v: number): void;
  /** Load a flash image into the core and reset PC/cycles/SREG. */
  writeFlash(words: Uint16Array): void;
  reset(): void;
  writePin(gpio: number, high: number): void;
  pinLevel(gpio: number): number;
  getFlashBase(): number;
  getFlashCapacity(): number;
  getCycles(): number;
  setCycles(v: number): void;
  getInstructions(): number;
}

/** Loads the committed wasm artifact. `loadBytes` is the test seam. */
export async function loadWasmAvrCpu(
  loadBytes?: () => Promise<ArrayBuffer>,
): Promise<WasmAvrCpu> {
  const exports = await instantiateEngine(loadBytes);
  return new WasmAvrCpuImpl(exports);
}

class WasmAvrCpuImpl implements WasmAvrCpu {
  private readonly exports: EngineExports;

  constructor(exports: EngineExports) {
    this.exports = exports;
  }

  step(budgetCycles: number): number {
    return this.exports.cpu_step(budgetCycles);
  }

  getPc(): number {
    return this.exports.cpu_get_pc();
  }

  setPc(v: number): void {
    this.exports.cpu_set_pc(v);
  }

  getReg(i: number): number {
    return this.exports.cpu_get_reg(i);
  }

  setReg(i: number, v: number): void {
    this.exports.cpu_set_reg(i, v);
  }

  getSreg(): number {
    return this.exports.cpu_get_sreg();
  }

  setSreg(v: number): void {
    this.exports.cpu_set_sreg(v);
  }

  getSp(): number {
    return this.exports.cpu_get_sp();
  }

  setSp(v: number): void {
    this.exports.cpu_set_sp(v);
  }

  getCycles(): number {
    return this.exports.cpu_get_cycles();
  }

  setCycles(v: number): void {
    this.exports.cpu_set_cycles(v);
  }

  getInstructions(): number {
    return this.exports.cpu_get_instructions();
  }

  getFlashCapacity(): number {
    return this.exports.cpu_get_flash_capacity();
  }

  getFlashBase(): number {
    return this.exports.cpu_flash_base();
  }

  reset(): void {
    this.exports.cpu_reset();
  }

  writeFlash(words: Uint16Array): void {
    if (words.length > this.getFlashCapacity()) {
      throw new Error(
        `program is ${words.length} words, wasm flash holds ${this.getFlashCapacity()}`,
      );
    }
    new Uint16Array(
      this.exports.memory.buffer,
      this.getFlashBase(),
      words.length,
    ).set(words);
    this.exports.cpu_reset();
  }

  writePin(gpio: number, high: number): void {
    this.exports.cpu_write_pin(gpio, high ? 1 : 0);
  }

  pinLevel(gpio: number): number {
    return this.exports.cpu_pin_level(gpio) !== 0 ? 1 : 0;
  }
}

const PACKED_FLAGS_MASK = 0x3f;
export { PACKED_FLAGS_MASK };
