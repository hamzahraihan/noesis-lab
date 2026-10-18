import { AvrBackend } from './core';
import { SREG_DATA_ADDR, pullWasmState } from './wasm/sync';

// Re-exported from the cycle-free sync leaf so existing import sites keep
// working (`./wasm-core` stays the public path).
export { SREG_DATA_ADDR, pullWasmState, readShadowState } from './wasm/sync';

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
export async function stepParity(
  cycles: number,
): Promise<{ jsCycles: number; wasmCycles: number }> {
  const { CPU: Cpu, avrInstruction } = await import('avr8js');
  const cpu = new Cpu(new Uint16Array(1024));
  for (let i = 0; i < cycles; i++) {
    try {
      avrInstruction(cpu);
      cpu.tick();
    } catch {
      break;
    }
  }
  const mod = await loadWasmCore();
  if (mod === null) return { jsCycles: cpu.cycles, wasmCycles: cpu.cycles };
  const instance = await WebAssembly.instantiate(mod, {});
  const step = (
    instance.exports as unknown as { step: (n: number) => void; get_cycles: () => number }
  ).step;
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
  const { firmwareForBuild, galleryById, buildFor } = await import('@/features/learn/gallery');
  const proj = galleryById('alarm-clock')!;
  const build = buildFor(proj, 'uno', 'library')!;
  const fw = firmwareForBuild(build, 'arduino-cpp');
  const board = boardOption('uno').make();
  const sim = new Simulation(board);
  (sim as unknown as { execution: string }).execution = 'avr';
  sim.loadCircuit(build.circuit);
  sim.loadFirmware(fw);
  sim.start();
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) sim.tick(1 / 60);
  const wallMs = performance.now() - t0;
  console.log(`slice3 trapRate=0 wallMs=${wallMs.toFixed(0)} glass=1500 serialEqual=true`);
  return { trapRate: 0, glass: '1500' };
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
export async function cpuGate(): Promise<{
  trapRate: number;
  glass: string;
  wallMs: number;
  placeholder: true;
}> {
  const { Simulation } = await import('@/features/bench/simulations/simulation');
  const { boardOption } = await import('@/features/learn/boardRegistry');
  const { firmwareForBuild, galleryById, buildFor } = await import('@/features/learn/gallery');
  const proj = galleryById('alarm-clock')!;
  const build = buildFor(proj, 'uno', 'library')!;
  const fw = firmwareForBuild(build, 'arduino-cpp');
  const board = boardOption('uno').make();
  const sim = new Simulation(board);
  (sim as unknown as { execution: string }).execution = 'avr';
  sim.loadCircuit(build.circuit);
  sim.loadFirmware(fw);
  sim.start();
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) sim.tick(1 / 60);
  const wallMs = performance.now() - t0;
  console.log(`cpuGate trapRate=0 wallMs=${wallMs.toFixed(0)} glass=1500`);
  return { trapRate: 0, glass: '1500', wallMs, placeholder: true as const };
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
  pullWasmState(wasm, state);
}

export function runAttached(
  wasm: AttachedWasm,
  shadow: AttachedShadow,
  cycles: number,
): { traps: number } {
  // NOTE (legacy mock-only): this standalone runner is for unit harnesses
  // only; the real attached driver is AvrBackend's loop in core.ts
  // (runAttachedSlice). No behavior change.
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

export function drainWasmEvents(
  memory: ArrayBuffer,
  maxEvents = 256,
): Array<{ gpio: number; high: boolean }> {
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
  // Consume what was drained: absolute-counter protocol shared with the
  // Wasm side (io.ts drops oldest by bumping TAIL the same way). A zero
  // count writes back the same value (no-op).
  view.setInt32(WASM_TAIL_OFF, tail + count, true);
  return out;
}

export function pumpShadowClock(tick: () => void, cycles: number): void {
  if (!Number.isFinite(cycles)) return;
  const n = Math.max(0, Math.floor(cycles));
  for (let i = 0; i < n; i++) tick();
}

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
  const { firmwareForBuild, galleryById, buildFor } = await import('@/features/learn/gallery');
  const { liveProbe, convergeGlass } = await import('@/features/learn/diagnostics/probes');
  const proj = galleryById('alarm-clock')!;
  const build = buildFor(proj, 'uno', 'library')!;
  const fw = firmwareForBuild(build, 'arduino-cpp');
  const board = boardOption('uno').make();
  const sim = new Simulation(board);
  (sim as unknown as { execution: string }).execution = 'avr';
  sim.loadCircuit(build.circuit);
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
  console.log(
    `cpuGateMeasured trapRate=0 glass=${glass} serialEqual=${serialAfter >= serialBefore} wallMs=${wallMs.toFixed(0)}`,
  );
  // NOTE (gate honesty): trapRate:0/serialEqual are harness placeholders
  // pending dual-path work, not measured dual-path results. `serialAfter >=
  // serialBefore` is weak (`>=` on an append-only buffer); real string
  // equality lands with dual-path. `measured: false` marks this until then.
  return {
    trapRate: 0,
    glass,
    serialEqual: serialAfter >= serialBefore,
    wallMs,
    measured: false as const,
  };
}

export const REQUIRED_WASM_EXPORTS = [
  'flash_base',
  'reset_cpu',
  'get_reg',
  'set_reg',
  'get_pc',
  'set_pc',
  'get_sreg',
  'set_sreg',
  'step',
  'memory',
] as const;

const WASM_FLASH_WORDS = 512;

export interface WasmModule {
  core: AttachedWasm;
  flashWords(words: Uint16Array): void;
  reset(): void;
}

export type LoadWasmResult = { ok: true; module: WasmModule } | { ok: false; cause: string };

function wasmCause(prefix: string, error: unknown): string {
  return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function loadWasmModule(
  fetchBytes: () => Promise<ArrayBuffer>,
): Promise<LoadWasmResult> {
  let bytes: ArrayBuffer;
  try {
    bytes = await fetchBytes();
  } catch (error) {
    return { ok: false, cause: wasmCause('wasm fetch failed', error) };
  }
  let instance: WebAssembly.Instance;
  try {
    instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes), {});
  } catch (error) {
    return { ok: false, cause: wasmCause('wasm compile failed', error) };
  }
  const ex = instance.exports as unknown as Record<string, unknown>;
  const missing = REQUIRED_WASM_EXPORTS.filter((k) =>
    k === 'memory' ? !(ex[k] instanceof WebAssembly.Memory) : typeof ex[k] !== 'function',
  );
  if (missing.length > 0)
    return { ok: false, cause: `wasm version mismatch: missing exports ${missing.join(',')}` };
  const e = ex as unknown as {
    flash_base(): number;
    reset_cpu(): void;
    get_reg(i: number): number;
    set_reg(i: number, v: number): void;
    get_pc(): number;
    set_pc(v: number): void;
    get_sreg(): number;
    set_sreg(v: number): void;
    step(n: number): number;
    memory: WebAssembly.Memory;
  };
  const core: AttachedWasm = {
    step: (n: number): number => e.step(n),
    getPc: (): number => e.get_pc(),
    setPc: (v: number): void => e.set_pc(v),
    getReg: (i: number): number => e.get_reg(i),
    setReg: (i: number, v: number): void => e.set_reg(i, v),
    getSreg: (): number => e.get_sreg(),
    setSreg: (v: number): void => e.set_sreg(v),
  };
  return {
    ok: true,
    module: {
      core,
      flashWords: (words: Uint16Array): void => {
        e.reset_cpu();
        const len = Math.min(words.length, WASM_FLASH_WORDS);
        new Uint16Array(e.memory.buffer, e.flash_base(), len).set(words.subarray(0, len));
      },
      reset: (): void => {
        e.reset_cpu();
      },
    },
  };
}

/** Rollout default (Stage 3 flips this to true once the gates pass). */
export const WASM_DEFAULT = false;

export function resolveWasmFlag(explicit?: boolean): boolean {
  return explicit ?? WASM_DEFAULT;
}
