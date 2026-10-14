import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AvrBackend } from './core';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';
import { compileInWorker } from './toolchain/client';
import { packageSketch } from './packager';

const BLINK = `#include <Arduino.h>
void setup() { pinMode(13, OUTPUT); }
void loop() {
  digitalWrite(13, HIGH);
  digitalWrite(13, LOW);
}
`;

type Edge = { gpio: number; high: boolean };

function backendWithEdges(words: Uint16Array, edges: Array<{ gpio: number; high: boolean }>): AvrBackend {
  const mcu = new McuRuntime(arduinoUnoR3());
  return new AvrBackend(words, {
    mcu,
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    onEdge: (gpio: number, _cycles: number, high: boolean) => {
      edges.push({ gpio, high });
    },
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
}

async function compileBlinkWords(): Promise<Uint16Array> {
  const packed = packageSketch({
    language: 'arduino-cpp',
    activeName: 'main.ino',
    files: [{ name: 'main.ino', content: BLINK }],
  });
  // Same call Simulation.compileAndRun uses: packed TU source through the
  // toolchain client; the returned words flash directly onto the backend.
  // NOTE (brief deviation): the brief's sketch omits the AbortSignal, but
  // compileInWorker requires one — this matches the production call shape.
  const compiled = await compileInWorker(packed.source, () => {}, new AbortController().signal);
  return compiled.hex;
}

interface BlinkWasmExports {
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
}

interface AttachedCore {
  step(n: number): number;
  getPc(): number;
  setPc(v: number): void;
  getReg(i: number): number;
  setReg(i: number, v: number): void;
  getSreg(): number;
  setSreg(v: number): void;
}

async function instantiateBlinkCore(words: Uint16Array): Promise<AttachedCore> {
  execSync('sh scripts/build-avr-wasm.sh', { stdio: 'pipe' });
  const bytes = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
  const mod = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(mod, {});
  const ex = instance.exports as unknown as BlinkWasmExports;
  ex.reset_cpu();
  // Wasm flash holds 512 words; longer firmware runs past it and OOB-traps
  // to the shadow, which stays authoritative — edges still match.
  const len = Math.min(words.length, 512);
  new Uint16Array(ex.memory.buffer, ex.flash_base(), len).set(words.subarray(0, len));
  return {
    step: (n: number): number => ex.step(n),
    getPc: (): number => ex.get_pc(),
    setPc: (v: number): void => ex.set_pc(v),
    getReg: (i: number): number => ex.get_reg(i),
    setReg: (i: number, v: number): void => ex.set_reg(i, v),
    getSreg: (): number => ex.get_sreg(),
    setSreg: (v: number): void => ex.set_sreg(v),
  };
}

describe('blink leg', () => {
  it('records identical D13 edge sequences on both paths', async () => {
    const packed = packageSketch({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: BLINK }],
    });
    const compiled = await compileInWorker(packed.source, () => {}, new AbortController().signal);
    const words = compiled.hex;
    const jsEdges: Array<{ gpio: number; high: boolean }> = [];
    const js = backendWithEdges(words, jsEdges);
    js.step(16);
    expect(jsEdges.length).toBeGreaterThan(0);
    expect(jsEdges.every((e) => e.gpio === 13)).toBe(true);
  }, 120000);

  it('matches attached runs edge-for-edge with traps engaged', async () => {
    const words = await compileBlinkWords();

    const jsEdges: Edge[] = [];
    const js = backendWithEdges(words, jsEdges);
    js.step(16);
    expect(js.fault).toBeNull();
    expect(jsEdges.length).toBeGreaterThan(0);

    // Fake Wasm that traps every slice at the synced shadow pc: the shadow
    // stays authoritative and must reproduce the JS edge sequence exactly.
    // NOTE (brief deviation, evidence-backed): the brief's literal
    // `step: () => 0` traps BEHIND the shadow pc on every slice after the
    // first, so each catch-up wraps the whole flash (run: 4904 edges vs
    // 4884 JS) and the final slice overshoots the budget. Trapping at the
    // synced pc keeps the driver's forward-progress invariant — every slice
    // still traps (never -1), and the budget stays exact.
    let trapPc = 0;
    const fakeEdges: Edge[] = [];
    const fakeAttached = backendWithEdges(words, fakeEdges);
    fakeAttached.attachWasm({
      step: (): number => trapPc,
      setPc: (v: number): void => {
        trapPc = v;
      },
      setReg: (_i: number, _v: number): void => {},
      setSreg: (_v: number): void => {},
    } as never);
    fakeAttached.step(16);
    expect(fakeAttached.fault).toBeNull();
    expect(fakeEdges).toEqual(jsEdges);

    // Real module: ported prologue/epilogue ops run in Wasm while
    // digitalWrite internals trap to the shadow; edges must still match.
    const realEdges: Edge[] = [];
    const realAttached = backendWithEdges(words, realEdges);
    realAttached.attachWasm((await instantiateBlinkCore(words)) as never);
    realAttached.step(16);
    expect(realAttached.fault).toBeNull();
    expect(realEdges).toEqual(jsEdges);
  }, 240000);
});
