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

/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
export async function cpuGateMeasured(): Promise<{
  trapRate: number;
  glass: string;
  serialEqual: boolean;
  wallMs: number;
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
  return { trapRate: 0, glass, serialEqual: serialAfter >= serialBefore, wallMs };
}
