/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';
import { TIER2_MANIFEST } from '@/features/simulation';
import { AvrBackend } from './core';
import { compileInWorker } from './toolchain/client';
import { packageSketch } from './packager';

const FADE = `#include <Arduino.h>
void setup() {}
void loop() { analogWrite(9, 128); }
`;

async function tier2Reachable(): Promise<boolean> {
  try {
    const response = await fetch(TIER2_MANIFEST[0].url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

interface FadeWasmExports {
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

async function instantiateAttachedCore(
  words: Uint16Array,
): Promise<{ core: AttachedCore; traps: { n: number } }> {
  // Committed-artifact read: avr-core.wasm is checked in, never rebuilt here.
  const bytes = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
  const mod = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(mod, {});
  const ex = instance.exports as unknown as FadeWasmExports;
  if (typeof (ex as unknown as Record<string, unknown>).set_pc !== 'function') {
    throw new Error(
      'avr-core.wasm missing `set_pc` export — rebuild with `sh scripts/build-avr-wasm.sh`',
    );
  }
  ex.reset_cpu();
  // Wasm flash holds 512 words; longer firmware runs past it and OOB-traps
  // to the shadow, which stays authoritative — duty still matches.
  const len = Math.min(words.length, 512);
  new Uint16Array(ex.memory.buffer, ex.flash_base(), len).set(words.subarray(0, len));
  const traps = { n: 0 };
  const rawStep = ex.step.bind(ex);
  const core: AttachedCore = {
    step: (n: number): number => {
      const r = rawStep(n);
      if (r !== -1) traps.n += 1;
      return r;
    },
    getPc: (): number => ex.get_pc(),
    setPc: (v: number): void => ex.set_pc(v),
    getReg: (i: number): number => ex.get_reg(i),
    setReg: (i: number, v: number): void => ex.set_reg(i, v),
    getSreg: (): number => ex.get_sreg(),
    setSreg: (v: number): void => ex.set_sreg(v),
  };
  return { core, traps };
}

function dutyBackend(words: Uint16Array): { backend: AvrBackend; mcu: McuRuntime } {
  const mcu = new McuRuntime(arduinoUnoR3());
  const backend = new AvrBackend(words, {
    mcu,
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
  return { backend, mcu };
}

describe('timer1 fade dual leg', () => {
  it('matches attached duty against JS within ±0.02', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch {
      /* fall through to skip */
    }
    if (!pkg) {
      console.warn('SKIP fade dual: toolchain absent');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP fade dual: Tier-2 fetch unreachable');
      return;
    }
    const packed = packageSketch({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: FADE }],
    });
    const compiled = await compileInWorker(packed.source, () => {}, new AbortController().signal);
    const words = compiled.hex;

    const jsRun = dutyBackend(words);
    for (let frame = 0; frame < 3; frame++) jsRun.backend.step(50);
    expect(jsRun.backend.fault, 'no JS core fault').toBeNull();
    const dutyJs = jsRun.mcu.configurationOf(jsRun.mcu.pinIdForGpio(9)!).duty;
    expect(dutyJs, 'JS D9 duty ~0.5').toBeGreaterThan(0.48);
    expect(dutyJs, 'JS D9 duty ~0.5').toBeLessThan(0.52);

    const atRun = dutyBackend(words);
    const { core, traps } = await instantiateAttachedCore(words);
    atRun.backend.attachWasm(core as never);
    const t0 = performance.now();
    for (let frame = 0; frame < 3; frame++) atRun.backend.step(50);
    const wallMs = performance.now() - t0;
    expect(atRun.backend.fault, 'no attached core fault').toBeNull();
    const dutyAt = atRun.mcu.configurationOf(atRun.mcu.pinIdForGpio(9)!).duty;
    console.log(
      `leg=timer1fade traps=${traps.n} wallMs=${wallMs.toFixed(0)} duty=${dutyAt.toFixed(3)}`,
    );
    expect(Math.abs(dutyAt - dutyJs), 'attached duty within ±0.02 of JS').toBeLessThanOrEqual(0.02);
  }, 1_500_000);
});
