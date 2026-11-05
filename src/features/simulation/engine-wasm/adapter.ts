/**
 * WasmEngine: TypeScript adapter over the Emscripten engine module.
 *
 * Expands the bench into the C++ netlist shape on the host (part definitions
 * live in TS) and serialises it to JSON for `engine_create`. Voltages and
 * serial output are live; part state, framebuffers and debug control are
 * honest stubs until the wiring lands.
 */
import type { Bench } from '../bench';
import type { McuRuntime } from '../mcu';
import type { DynamicState } from '@/features/parts';
import { NO_DYNAMIC_STATE } from '@/features/parts';
import { buildNetlist } from '../netlist';
import { ProbeDeck } from '../probe';
import { COMPONENT_KIND, paramsFor } from './netlist';
import { KEYPAD_KEYS } from '@/features/parts';

export interface WasmEngineOptions {
  bench: Bench;
  mcu: McuRuntime;
  dynamicState?: DynamicState;
}

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

export class WasmEngine {
  readonly mcu: McuRuntime;
  readonly probes = new ProbeDeck();

  timeMs = 0;

  private bench: Bench;
  private dynamicState: DynamicState;
  private module: FfiExports | null = null;
  private handle = 0;
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
    const expanded = expandBench(this.bench, this.dynamicState);
    const mod = this.module;
    const circuitPtr = allocString(mod, JSON.stringify(expanded));
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

class StringTable {
  private bytes: number[] = [0];
  private offsets = new Map<string, number>();
  intern(value: string | undefined | null): number {
    if (!value) return 0;
    const existing = this.offsets.get(value);
    if (existing !== undefined) return existing;
    const offset = this.bytes.length;
    for (const byte of new TextEncoder().encode(value)) this.bytes.push(byte);
    this.bytes.push(0);
    this.offsets.set(value, offset);
    return offset;
  }
  finish(): string {
    return String.fromCharCode(...this.bytes);
  }
}

function expandBench(bench: Bench, state: DynamicState): Record<string, unknown> {
  const strings = new StringTable();
  const pins: { terminal: number; nameOffset: number; netOffset: number }[] = [];
  const knobs: { value: number; min: number; max: number; nameOffset: number }[] = [];
  const parts: {
    kind: number;
    firstPin: number;
    pinCount: number;
    firstKnob: number;
    knobCount: number;
    flags: number;
    params: number[];
    scripted: number;
  }[] = [];
  const wires: { from: number; to: number; idOffset: number; gaugeAwg: number; lengthMm: number }[] = [];
  const ground: number[] = [];

  for (const part of bench.parts) {
    const firstPin = pins.length;
    const firstKnob = knobs.length;
    const component = part.definition.component;
    const pinSpecs = new Map<string, { net?: string }>(
      part.definition.pins.map((pin): [string, { net?: string }] => [pin.id, pin]),
    );

    for (const pinId of Object.keys(part.terminals)) {
      const terminal = part.terminals[pinId];
      const spec = pinSpecs.get(pinId);
      pins.push({
        terminal,
        nameOffset: strings.intern(pinId),
        netOffset: strings.intern(spec?.net),
      });
    }

    for (const knob of part.definition.knobs ?? []) {
      knobs.push({
        value: state.knob(part.id, knob),
        min: knob.min,
        max: knob.max,
        nameOffset: strings.intern(knob.id),
      });
    }

    let flags = 0;
    if (state.isPressed(part.id)) flags |= 1;
    parts.push({
      kind: COMPONENT_KIND[component.kind],
      firstPin,
      pinCount: pins.length - firstPin,
      firstKnob,
      knobCount: knobs.length - firstKnob,
      flags,
      params: paramsFor(component, () => 0),
      scripted: 0,
    });

    if (component.kind === 'mcu') {
      for (const pin of part.definition.boardPins ?? []) {
        if (pin.role !== 'ground') continue;
        const terminal = part.terminals[pin.id];
        if (terminal !== undefined) ground.push(terminal);
      }
    }
  }

  for (const wire of bench.wires) {
    wires.push({
      from: wire.from,
      to: wire.to,
      idOffset: strings.intern(wire.id),
      gaugeAwg: wire.gaugeAwg,
      lengthMm: wire.lengthMm,
    });
  }

  const keyLabels = KEYPAD_KEYS.map((key) => strings.intern(key));

  // pinNode: terminal -> node index (from TS buildNetlist, computed separately).
  // We don't have it here; pass an empty-ish map. The C++ engine uses pin_node
  // from the circuit JSON; if absent, pin stamping is skipped.
  const tsNetlist = buildNetlist(bench, state);
  const pinNodeArr: number[] = new Array(bench.terminals.length).fill(-1);
  for (const [key, node] of tsNetlist.pinNode) {
    // key is "partId:pinId"; resolve to terminal via bench
    const [partId, pinId] = key.split(':');
    const part = bench.parts.find((p) => p.id === partId);
    if (part && part.terminals[pinId] !== undefined) {
      pinNodeArr[part.terminals[pinId]] = node;
    }
  }

  // pinTerminals: "partId:pinId" -> terminal index
  const pinTerminals: Record<string, number> = {};
  for (const part of bench.parts) {
    for (const pinId of Object.keys(part.terminals)) {
      pinTerminals[`${part.id}:${pinId}`] = part.terminals[pinId];
    }
  }

  // knobMap: "partId:knobId" -> knob index (flat)
  const knobMap: Record<string, number> = {};
  let knobIndex = 0;
  for (const part of bench.parts) {
    for (const knob of part.definition.knobs ?? []) {
      knobMap[`${part.id}:${knob.id}`] = knobIndex++;
    }
  }

  const supplyNode = -1;

  return {
    terminals: bench.terminals.map((t) => ({ x: t.x, y: t.y })),
    parts: parts.map((p) => ({
      kind: p.kind,
      first_pin: p.firstPin,
      pin_count: p.pinCount,
      first_knob: p.firstKnob,
      knob_count: p.knobCount,
      flags: p.flags,
      params: p.params,
      scripted: p.scripted,
    })),
    pins: pins.map((p) => ({
      terminal: p.terminal,
      name_offset: p.nameOffset,
      net_offset: p.netOffset,
    })),
    knobs: knobs.map((k) => ({
      value: k.value,
      min: k.min,
      max: k.max,
      name_offset: k.nameOffset,
    })),
    wires: wires.map((w) => ({
      from: w.from,
      to: w.to,
      id_offset: w.idOffset,
      gauge_awg: w.gaugeAwg,
      length_mm: w.lengthMm,
    })),
    groundTerminals: ground,
    keyLabels: keyLabels,
    strings: strings.finish(),
    irTransmitting: 0,
    redProfile: 0,
    greenProfile: 0,
    blueProfile: 0,
    pinNode: pinNodeArr,
    pinTerminals,
    knobMap,
    supplyNode,
  };
}

export function isWasmDefault(): boolean {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const v = env?.WASM_DEFAULT;
  return v === '1' || v === 'true';
}
