/**
 * Loads the committed Emscripten engine module (built by
 * `npm run build:engine:ffi`) and checks the contract the adapter in #57 will
 * rely on: every declared entry point exists, the stub status is honest, and
 * the linear memory can grow past INITIAL_MEMORY.
 *
 * The raw wasm is instantiated directly, without the Emscripten glue: its only
 * imports are the three host math functions, so the test needs no browser and
 * no Emscripten runtime. The glue itself is checked as text.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENGINE_EXPORTS } from '../../../../scripts/lib/engine-exports.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', '..');
const WASM_PATH = join(ROOT, 'public', 'assets', 'engine.wasm');
const JS_PATH = join(ROOT, 'public', 'assets', 'engine.js');
const MANIFEST_PATH = join(ROOT, 'native', 'engine-ffi-manifest.json');
const SCHEMA_PATH = join(ROOT, 'native', 'abi', 'engine-ffi.schema.json');

/** The engine surface that predates the FFI entry points (phase 1-3). */
const CORE_EXPORTS = ENGINE_EXPORTS;

interface EngineExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  wasm_alloc(bytes: number): number;
  set_profiles(values: number, count: number): number;
  engine_create(circuitJson: number, sketchJson: number): number;
  engine_step(handle: number, dtMs: number): number;
  engine_set_pin(handle: number, partId: number, pin: number, level: number): number;
  engine_set_knob(handle: number, partId: number, knob: number, value: number): number;
  engine_get_state(handle: number, outCount: number): number;
  engine_get_voltages(handle: number, outCount: number): number;
  engine_get_serial(handle: number): number;
  engine_destroy(handle: number): void;
}

async function instantiate(onMemoryGrowth: () => void = () => {}): Promise<EngineExports> {
  const module = await WebAssembly.compile(readFileSync(WASM_PATH));
  const instance = await WebAssembly.instantiate(module, {
    env: {
      js_exp: Math.exp,
      js_log1p: Math.log1p,
      js_pow: Math.pow,
      // Emscripten's hook refreshes Module.HEAPU8/HEAPF64/HEAP32 after a raw grow.
      emscripten_notify_memory_growth: onMemoryGrowth,
    },
  });
  return instance.exports as unknown as EngineExports;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
  ffi: { exports: Array<{ name: string }> };
};
const declared = schema.ffi.exports.map((entry) => entry.name);

describe('Emscripten engine module', () => {
  let exportsTable: EngineExports;

  beforeAll(async () => {
    exportsTable = await instantiate();
  });

  it('matches its manifest', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const wasm = readFileSync(WASM_PATH);
    const glue = readFileSync(JS_PATH);

    expect(manifest.file).toBe('engine.wasm');
    expect(manifest.wasmSha256).toBe(sha256(wasm));
    expect(manifest.jsSha256).toBe(sha256(glue));
    expect(manifest.sourcesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.toolchain.emcc).toBeTypeOf('string');
  });

  it('exports every entry point declared in the FFI schema', () => {
    for (const name of declared) {
      expect(exportsTable[name], `${name} is missing from engine.wasm`).toBeTypeOf('function');
    }
  });

  it('keeps the phase 1-3 engine surface', () => {
    for (const name of CORE_EXPORTS) {
      expect(exportsTable[name], `${name} is missing from engine.wasm`).toBeTypeOf('function');
    }
  });

  it('imports only the host math functions and the growth hook', async () => {
    const module = await WebAssembly.compile(readFileSync(WASM_PATH));
    const imports = WebAssembly.Module.imports(module).map(
      (entry) => `${entry.module}.${entry.name}`,
    );

    expect(imports.sort()).toEqual([
      'env.emscripten_notify_memory_growth',
      'env.js_exp',
      'env.js_log1p',
      'env.js_pow',
    ]);
  });

  it('runs the firmware VM end to end', () => {
    const countPtr = exportsTable.wasm_alloc(4);
    expect(countPtr).not.toBe(0);
    new Int32Array(exportsTable.memory.buffer, countPtr, 1)[0] = 99;

    // A handle is allocated for a (possibly empty) sketch.
    const handle = exportsTable.engine_create(0, 0);
    expect(handle).toBeGreaterThan(0);

    // The VM step loop runs without claiming to have solved anything yet.
    expect(exportsTable.engine_step(handle, 1)).toBe(0);
    expect(exportsTable.engine_set_pin(handle, 0, 0, 1)).toBe(1);  // null part_id/pin
    expect(exportsTable.engine_set_knob(handle, 0, 0, 0.5)).toBe(1);  // null part_id/knob
    expect(exportsTable.engine_get_state(handle, countPtr)).toBe(0);
    expect(new Int32Array(exportsTable.memory.buffer, countPtr, 1)[0]).toBe(0);
    expect(exportsTable.engine_get_voltages(handle, countPtr)).toBe(0);
    expect(new Int32Array(exportsTable.memory.buffer, countPtr, 1)[0]).toBe(0);
    const serialPtr = exportsTable.engine_get_serial(handle);
    expect(serialPtr).toBeGreaterThan(0);
    expect(new Uint8Array(exportsTable.memory.buffer)[serialPtr]).toBe(0);
    expect(() => exportsTable.engine_destroy(handle)).not.toThrow();
  });

  it('grows linear memory past INITIAL_MEMORY for large workloads', async () => {
    // A fresh instance so the growth check does not depend on test order.
    let growthNotifications = 0;
    const fresh = await instantiate(() => {
      growthNotifications += 1;
    });
    const initial = fresh.memory.buffer.byteLength;
    expect(initial).toBe(32 * 1024 * 1024);

    // 1000 elements is a few tens of KB; this asks for more than the whole
    // initial heap to prove MAXIMUM_MEMORY/ALLOW_MEMORY_GROWTH are wired.
    const bytes = 40 * 1024 * 1024;
    const pointer = fresh.wasm_alloc(bytes);

    expect(pointer).not.toBe(0);
    expect(fresh.memory.buffer.byteLength).toBeGreaterThan(initial);
    expect(fresh.memory.buffer.byteLength).toBeGreaterThanOrEqual(initial + 8 * 1024 * 1024);
    // The hook is what refreshes the glue's HEAP views; without it the host
    // reads a detached buffer after the first growth.
    expect(growthNotifications).toBe(1);
  });

  it('emits an ES module glue that loads engine.wasm beside it', () => {
    const glue = readFileSync(JS_PATH, 'utf8');

    expect(glue).toContain('export default EngineModule');
    expect(glue).toContain('engine.wasm');
    expect(glue).toContain('import.meta.url');
    // LF in the committed artifact, or the manifest hash depends on the host.
    expect(glue).not.toContain('\r');
  });
});
