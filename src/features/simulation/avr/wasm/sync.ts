// Cycle-free sync leaf: shadow <-> wasm state transfer. No imports from
// core.ts or wasm-core.ts (keeps the core<->wasm-core seam free of an
// import cycle); both import SREG_DATA_ADDR from here.
export const SREG_DATA_ADDR = 0x5f;

export interface SyncWasm {
  setReg(i: number, v: number): void;
  setPc(v: number): void;
  setSreg(v: number): void;
}

export interface SyncShadowState {
  regs: number[];
  pc: number;
  sreg: number;
}

export function pullWasmState(wasm: SyncWasm, shadow: SyncShadowState): void {
  for (let i = 0; i < 32; i++) wasm.setReg(i, shadow.regs[i] ?? 0);
  wasm.setPc(shadow.pc);
  wasm.setSreg(shadow.sreg);
}

export function readShadowState(cpu: { data: ArrayLike<number>; pc: number }): SyncShadowState {
  const regs: number[] = [];
  for (let i = 0; i < 32; i++) regs.push((cpu.data[i] ?? 0) & 0xff);
  return { regs, pc: cpu.pc, sreg: (cpu.data[SREG_DATA_ADDR] ?? 0) & 0xff };
}
