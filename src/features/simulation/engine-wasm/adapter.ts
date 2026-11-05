/**
 * WasmEngine: TypeScript adapter over the Emscripten engine module.
 *
 * Implements the same public surface as `Engine` (see `engine.ts`) but delegates
 * the simulation to the C++ core in `public/assets/engine.wasm`. The TypeScript
 * `Engine` remains the default until `WASM_DEFAULT` is set, so this adapter is
 * only reached by explicit opt-in and the parity tests.
 *
 * Marshalling is intentionally simple at this stage: the bench is expanded to
 * the netlist shape on the host and serialised to JSON for `engine_create`,
 * because the freestanding core has no part-definition table. Part state,
 * framebuffers, debug control and pin/knob stamping are honest stubs until the
 * wiring lands; voltages and serial output are live.
 */
interface FfiExports {
  readonly memory: WebAssembly.Memory;
  wasm_alloc(bytes: number): number;
  engine_create(circuitJson: number, sketchJson: number): number;
  engine_step(handle: number, dtMs: number): number;
  engine_set_pin(handle: number, partId: number, pin: number, level: number): number;
  engine_set_knob(handle: number, partId: number, knob: number, value: number): number;
  engine_get_state(handle: number, outCount: number): number;
  engine_get_voltages(handle: number, outCount: number): number;
  engine_get_serial(handle: number): number;
  engine_destroy(handle: number): void;
}

async function instantiateEngineModule(): Promise<FfiExports> {
  const response = await fetch(new URL('/assets/engine.wasm', import.meta.url));
  if (!response.ok) throw new Error(`engine.wasm: HTTP ${response.status}`);
  const module = await WebAssembly.compile(await response.arrayBuffer());
  const instance = await WebAssembly.instantiate(module, {
    env: {
      js_exp: Math.exp,
      js_log1p: Math.log1p,
      js_pow: Math.pow,
      emscripten_notify_memory_growth: () => {},
    },
  });
  return instance.exports as unknown as FfiExports;
}

import type { Bench } from '../bench';
import type { McuRuntime } from '../mcu';
import type { DynamicState } from '@/features/parts';
import { NO_DYNAMIC_STATE } from '@/features/parts';
import { buildNetlist } from '../netlist';
import type { Netlist } from '../netlist';
import { ProbeDeck } from '../probe';

export interface WasmEngineOptions {
  bench: Bench;
  mcu: McuRuntime;
  dynamicState?: DynamicState;
}

export class WasmEngine {
  readonly mcu: McuRuntime;
  readonly probes = new ProbeDeck();

  timeMs = 0;

  private bench: Bench;
  private dynamicState: DynamicState;
  private module: FfiExports | null = null;
  private handle = 0;
  private netlist: Netlist | null = null;
  private voltages: Float64Array = new Float64Array(0);
  private serialOutput = '';
  private pendingSketch = '';

  private constructor(options: WasmEngineOptions) {
    this.bench = options.bench;
    this.mcu = options.mcu;
    this.dynamicState = options.dynamicState ?? NO_DYNAMIC_STATE;
  }

  static async create(options: WasmEngineOptions): Promise<WasmEngine> {
    const engine = new WasmEngine(options);
    engine.module = await instantiateEngineModule();
    return engine;
  }

  async loadSketch(src: string, _lang: 'cpp' | 'py'): Promise<void> {
    this.pendingSketch = src;
  }

  async loadCircuit(_json: unknown): Promise<void> {
    if (!this.module) throw new Error('WasmEngine: module not loaded');
    this.netlist = buildNetlist(this.bench, this.dynamicState);
    const circuitJson = JSON.stringify(toExpandedNetlist(this.netlist));
    const mod = this.module;
    const circuitPtr = allocString(mod, circuitJson);
    const sketchPtr = allocString(mod, this.pendingSketch);
    this.handle = mod.engine_create(circuitPtr, sketchPtr);
    if (this.handle === 0) throw new Error('WasmEngine: engine_create failed');
  }

  async step(dtMs: number): Promise<void> {
    if (!this.module || this.handle === 0) return;
    this.timeMs += dtMs;
    const mod = this.module;
    const status = mod.engine_step(this.handle, dtMs);
    if (status !== 0) throw new Error(`WasmEngine: engine_step failed (${status})`);
    const serialPtr = mod.engine_get_serial(this.handle);
    this.serialOutput = readCString(mod, serialPtr);
    const countPtr = mod.wasm_alloc(4);
    const voltPtr = mod.engine_get_voltages(this.handle, countPtr);
    const count = new Int32Array(mod.memory.buffer, countPtr, 1)[0];
    if (voltPtr !== 0 && count > 0) {
      this.voltages = new Float64Array(mod.memory.buffer, voltPtr, count).slice();
    } else {
      this.voltages = new Float64Array(0);
    }
  }

  async settle(): Promise<void> {
    await this.step(1e-5 * 1000);
  }

  writeDigital(_gpio: number, _level: boolean): void {}
  turnKnob(_partId: string, _knob: string, _value: number): void {}
  pressButton(_partId: string, _pressed: boolean): void {}
  setMeterMode(_mode: unknown): void {}

  getVoltages(): Float64Array {
    return this.voltages;
  }

  getPartStates(): unknown[] {
    return [];
  }

  getSerialOutput(): string {
    return this.serialOutput;
  }

  getDisplayFramebuffers(): Map<string, unknown> {
    return new Map();
  }

  setBreakpoint(_pc: number): void {}
  continue(): void {}
  stepOver(): void {}
  stepInto(): void {}
  getDebugState(): unknown {
    return null;
  }

  destroy(): void {
    if (this.module && this.handle !== 0) {
      this.module.engine_destroy(this.handle);
      this.handle = 0;
    }
    this.module = null;
  }
}

function allocString(mod: FfiExports, s: string): number {
  const bytes = new TextEncoder().encode(s + '\0');
  const ptr = mod.wasm_alloc(bytes.length);
  new Uint8Array(mod.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
}

function readCString(mod: FfiExports, ptr: number): string {
  if (ptr === 0) return '';
  const mem = new Uint8Array(mod.memory.buffer);
  let end = ptr;
  while (mem[end] !== 0) end++;
  return new TextDecoder().decode(mem.slice(ptr, end));
}

function toExpandedNetlist(netlist: Netlist): Record<string, unknown> {
  // The freestanding core has no part-definition table, so expansion stays
  // here. For now we emit the terminal/node skeleton; part/pin/wire
  // expansion is a follow-up that mirrors buildNetlist's per-kind emission.
  return {
    terminals: Array.from(netlist.nodeOfTerminal, () => ({ x: 0, y: 0 })),
    parts: [],
    pins: [],
    knobs: [],
    wires: [],
    groundTerminals: [],
    keyLabels: [],
    strings: [''],
    irTransmitting: 0,
    redProfile: 0,
    greenProfile: 0,
    blueProfile: 0,
  };
}

export function isWasmDefault(): boolean {
  // Vite exposes env vars via import.meta.env.
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const v = env?.WASM_DEFAULT;
  return v === '1' || v === 'true';
}
