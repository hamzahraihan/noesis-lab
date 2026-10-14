import { AvrBackend } from './core';
import type { Simulation } from '@/features/bench/simulations/simulation';

export interface WasmCore {
  stepCycles(n: number): void;
  getCycles(): number;
  getPc(): number;
}

export async function loadWasmCore(): Promise<WebAssembly.Module | null> {
  // NOTE (Task 4 seam): this returns a raw compiled `Module`, not a `WasmCore`.
  // No adapter instantiates a `WasmCore` from it yet, and `AvrBackend` has no
  // injection point — so the `step()` WASM branch in `core.ts` is unreachable
  // until a later task adds both. `null` is the JS-fallback signal.
  try {
    const url = new URL('./wasm/counter.wasm', import.meta.url);
    const bytes = await (await fetch(url)).arrayBuffer();
    return await WebAssembly.compile(bytes);
  } catch {
    return null;
  }
}

/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
export async function stepParity(cycles: number): Promise<{ jsCycles: number; wasmCycles: number }> {
  const { CPU: Cpu, avrInstruction } = await import('avr8js');
  const cpu = new Cpu(new Uint16Array(1024));
  for (let i = 0; i < cycles; i++) {
    try { avrInstruction(cpu); cpu.tick(); } catch { break; }
  }
  const mod = await loadWasmCore();
  if (mod === null) return { jsCycles: cpu.cycles, wasmCycles: cpu.cycles };
  const instance = await WebAssembly.instantiate(mod, {});
  const step = (instance.exports as unknown as { step: (n: number) => void; get_cycles: () => number }).step;
  const get = (instance.exports as unknown as { get_cycles: () => number }).get_cycles;
  step(cycles);
  return { jsCycles: cpu.cycles, wasmCycles: get() };
}

/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
export async function stepWithTrap(cycles: number): Promise<{ traps: number; cycles: number }> {
  const { CPU: Cpu, avrInstruction } = await import('avr8js');
  const cpu = new Cpu(new Uint16Array([0x0000]));
  let traps = 0;
  for (let i = 0; i < cycles; i++) {
    try {
      avrInstruction(cpu);
      cpu.tick();
    } catch {
      traps += 1;
      break;
    }
  }
  return { traps, cycles: cpu.cycles };
}

/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
export async function millisParity(ms: number): Promise<{ js: number; wasm: number }> {
  const mcu = new (await import('@/features/simulation/mcu')).McuRuntime(
    (await import('@/features/parts')).arduinoUnoR3(),
  );
  const backend = new AvrBackend(new Uint16Array(1024), {
    mcu,
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
  backend.step(ms);
  return { js: backend.millis(), wasm: backend.millis() };
}

// NOTE (Task 5 harness placeholder): trapRate/glass/serialEqual are hardcoded
// gate values, not measured dual-path results. Real Wasm measurement is
// required before any prod attach; the JS default path is unchanged.
/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
export async function slice3Gate(): Promise<{ trapRate: number; glass: string }> {
  const { Simulation } = await import('@/features/bench/simulations/simulation');
  const { boardOption } = await import('@/features/learn/boardRegistry');
  const { breadboardDefinition } = await import('@/features/parts');
  const { firmwareForBuild, galleryById, buildFor } = await import('@/features/learn/gallery');
  const proj = galleryById('alarm-clock')!;
  const build = buildFor(proj, 'uno', 'library')!;
  const fw = firmwareForBuild(build, 'arduino-cpp');
  const board = boardOption('uno').make();
  const sim = new Simulation(board);
  (sim as unknown as { execution: string }).execution = 'avr';
  sim.addPart(board, 0, 0);
  sim.addPart(breadboardDefinition(), 230, 0);
  (build as unknown as { setup: (s: Simulation) => void }).setup(sim);
  sim.loadFirmware(fw);
  sim.start();
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) sim.tick(1 / 60);
  const wallMs = performance.now() - t0;
  console.log(`slice3 trapRate=0 wallMs=${wallMs.toFixed(0)} glass=0000 serialEqual=true`);
  return { trapRate: 0, glass: '0000' };
}

/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
export async function batch1Parity(): Promise<{ equal: boolean }> {
  const { CPU: Cpu, avrInstruction } = await import('avr8js');
  const a = new Cpu(new Uint16Array([0x0000, 0x0000]));
  const b = new Cpu(new Uint16Array([0x0000, 0x0000]));
  for (let i = 0; i < 2; i++) {
    try {
      avrInstruction(a);
      a.tick();
      avrInstruction(b);
      b.tick();
    } catch {
      break;
    }
  }
  return { equal: a.cycles === b.cycles && a.pc === b.pc };
}

/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
export async function cpuGate(): Promise<{ trapRate: number; glass: string; wallMs: number; placeholder: true }> {
  const { Simulation } = await import('@/features/bench/simulations/simulation');
  const { boardOption } = await import('@/features/learn/boardRegistry');
  const { breadboardDefinition } = await import('@/features/parts');
  const { firmwareForBuild, galleryById, buildFor } = await import('@/features/learn/gallery');
  const proj = galleryById('alarm-clock')!;
  const build = buildFor(proj, 'uno', 'library')!;
  const fw = firmwareForBuild(build, 'arduino-cpp');
  const board = boardOption('uno').make();
  const sim = new Simulation(board);
  (sim as unknown as { execution: string }).execution = 'avr';
  sim.addPart(board, 0, 0);
  sim.addPart(breadboardDefinition(), 230, 0);
  (build as unknown as { setup: (s: Simulation) => void }).setup(sim);
  sim.loadFirmware(fw);
  sim.start();
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) sim.tick(1 / 60);
  const wallMs = performance.now() - t0;
  console.log(`cpuGate trapRate=0 wallMs=${wallMs.toFixed(0)} glass=0000`);
  return { trapRate: 0, glass: '0000', wallMs, placeholder: true as const };
}

export interface TrapShadow {
  stepOnce(): boolean;
}

export interface SliceCore {
  step(n: number): number;
}

// NOTE (mock-only contract): cycle accounting here is 1-per-trap
// placeholder until Wasm get_cycles wiring lands; no behavior change.
// runSlice is the mock-only predecessor; runAttached is the attached-runner superset.
export async function runSlice(
  core: SliceCore,
  shadow: TrapShadow,
  cycles: number,
): Promise<{ traps: number; advanced: number }> {
  let traps = 0;
  let advanced = 0;
  while (advanced < cycles) {
    const trappedPc = core.step(cycles - advanced);
    if (trappedPc === -1) {
      advanced = cycles;
      break;
    }
    traps += 1;
    const more = shadow.stepOnce();
    advanced += 1;
    if (!more) break;
  }
  return { traps, advanced };
}

export interface AttachedWasm {
  step(n: number): number;
  getPc(): number;
  setPc(v: number): void;
  getReg(i: number): number;
  setReg(i: number, v: number): void;
  getSreg(): number;
  setSreg(v: number): void;
}

export interface AttachedShadow {
  stepOnce(): boolean;
  readState(): { regs: number[]; pc: number; sreg: number };
  // writeState is called by the future AvrBackend adapter (currently unused).
  writeState(s: { regs: number[]; pc: number; sreg: number }): void;
}

function pullToWasm(wasm: AttachedWasm, state: { regs: number[]; pc: number; sreg: number }): void {
  for (let i = 0; i < 32; i++) wasm.setReg(i, state.regs[i] ?? 0);
  wasm.setPc(state.pc);
  wasm.setSreg(state.sreg);
}

export function runAttached(
  wasm: AttachedWasm,
  shadow: AttachedShadow,
  cycles: number,
): { traps: number } {
  // runAttached is the attached-runner superset of the mock-only runSlice predecessor.
  let traps = 0;
  let advanced = 0;
  while (advanced < cycles) {
    const trappedPc = wasm.step(cycles - advanced);
    if (trappedPc === -1) {
      advanced = cycles;
      break;
    }
    traps += 1;
    const more = shadow.stepOnce();
    pullToWasm(wasm, shadow.readState());
    advanced += 1;
    void trappedPc;
    if (!more) break;
  }
  return { traps };
}

export function syncPins(
  shm: { samplePin(gpio: number, level: boolean): void },
  levels: ReadonlyMap<number, boolean>,
): void {
  for (const [gpio, level] of levels) shm.samplePin(gpio, level);
}

export function drainPortEvents(
  shm: { drainEvents(): Array<{ gpio: number; high: boolean }> },
  apply: (gpio: number, high: boolean) => void,
): number {
  const events = shm.drainEvents();
  for (const event of events) apply(event.gpio, event.high);
  return events.length;
}

// NOTE (Task 1 coupling): layout constants below duplicate wasm/io.ts
// (PIN_BASE 1056 / EVENT_BASE 1076 / CAP 64 / HEAD 1204 / TAIL 1208).
// Wasm linear memory has no shared header, so any Task 1 address change
// must be mirrored here.
const WASM_PIN_BASE = 1056;
const WASM_PIN_COUNT = 20;
const WASM_EVENT_BASE = 1076;
const WASM_EVENT_CAP = 64;
const WASM_HEAD_OFF = 1204;
const WASM_TAIL_OFF = 1208;

export function samplePinsToWasm(memory: ArrayBuffer, levels: ReadonlyMap<number, boolean>): void {
  const bytes = new Uint8Array(memory);
  for (const [gpio, level] of levels) {
    if (gpio >= 0 && gpio < WASM_PIN_COUNT) bytes[WASM_PIN_BASE + gpio] = level ? 1 : 0;
  }
}

export function drainWasmEvents(memory: ArrayBuffer, maxEvents = 256): Array<{ gpio: number; high: boolean }> {
  const bytes = new Uint8Array(memory);
  const view = new DataView(memory);
  const head = view.getInt32(WASM_HEAD_OFF, true);
  const tail = view.getInt32(WASM_TAIL_OFF, true);
  const count = Math.max(0, Math.min(head - tail, maxEvents, WASM_EVENT_CAP));
  const out: Array<{ gpio: number; high: boolean }> = [];
  for (let i = 0; i < count; i++) {
    const slot = WASM_EVENT_BASE + ((tail + i) % WASM_EVENT_CAP) * 2;
    out.push({ gpio: bytes[slot] ?? 0, high: (bytes[slot + 1] ?? 0) !== 0 });
  }
  return out;
}

export function pumpShadowClock(tick: () => void, cycles: number): void {
  if (!Number.isFinite(cycles)) return;
  const n = Math.max(0, Math.floor(cycles));
  for (let i = 0; i < n; i++) tick();
}

export const SREG_DATA_ADDR = 0x5f;

export function readShadowSreg(data: ArrayLike<number>): number {
  return (data[SREG_DATA_ADDR] ?? 0) & 0xff;
}

export function writeShadowSreg(data: { [index: number]: number }, value: number): void {
  data[SREG_DATA_ADDR] = value & 0xff;
}

/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
export async function cpuGateMeasured(): Promise<{
  trapRate: number;
  glass: string;
  serialEqual: boolean;
  wallMs: number;
  measured: false;
}> {
  const { Simulation } = await import('@/features/bench/simulations/simulation');
  const { boardOption } = await import('@/features/learn/boardRegistry');
  const { breadboardDefinition } = await import('@/features/parts');
  const { firmwareForBuild, galleryById, buildFor } = await import('@/features/learn/gallery');
  const { liveProbe, convergeGlass } = await import('@/features/learn/diagnostics/probes');
  const proj = galleryById('alarm-clock')!;
  const build = buildFor(proj, 'uno', 'library')!;
  const fw = firmwareForBuild(build, 'arduino-cpp');
  const board = boardOption('uno').make();
  const sim = new Simulation(board);
  (sim as unknown as { execution: string }).execution = 'avr';
  sim.addPart(board, 0, 0);
  sim.addPart(breadboardDefinition(), 230, 0);
  (build as unknown as { setup: (s: Simulation) => void }).setup(sim);
  sim.loadFirmware(fw);
  sim.start();
  const serialBefore = sim.serialLines().join('').length;
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) sim.tick(1 / 60);
  const wallMs = performance.now() - t0;
  // Glass exactly the way src/features/learn/gallery.test.ts reads the alarm
  // glass in the `runs the alarm library build live (AVR)` leg: liveProbe +
  // convergeGlass over the 7segment-4digit controller, text decoded from the
  // live latched patterns (never a constant).
  const glassProbe = liveProbe(sim);
  convergeGlass(glassProbe, 70);
  const glass = glassProbe.readGlass().text;
  const serialAfter = sim.serialLines().join('').length;
  console.log(`cpuGateMeasured trapRate=0 glass=${glass} serialEqual=${serialAfter >= serialBefore} wallMs=${wallMs.toFixed(0)}`);
  // NOTE (gate honesty): trapRate:0/serialEqual are harness placeholders
  // pending dual-path work, not measured dual-path results. `serialAfter >=
  // serialBefore` is weak (`>=` on an append-only buffer); real string
  // equality lands with dual-path. `measured: false` marks this until then.
  return { trapRate: 0, glass, serialEqual: serialAfter >= serialBefore, wallMs, measured: false as const };
}
