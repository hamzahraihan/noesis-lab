import { describe, expect, it } from 'vitest';
import { Simulation } from '@/features/bench/simulations/simulation';
import { boardOption } from '@/features/learn/boardRegistry';
import { firmwareForBuild, galleryById, buildFor } from '@/features/learn/gallery';

describe('wasm perf gate', () => {
  it('splits cpu vs settle time', () => {
    const proj = galleryById('alarm-clock')!;
    const build = buildFor(proj, 'uno', 'library')!;
    const fw = firmwareForBuild(build, 'arduino-cpp');
    const mk = () => {
      const b = boardOption('uno').make();
      const s = new Simulation(b);
      s.execution = 'avr';
      s.loadCircuit(build.circuit);
      s.loadFirmware(fw);
      s.start();
      return s;
    };
    const full = mk();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) full.tick(1 / 60);
    const fullMs = performance.now() - t0;
    const noop = mk();
    (noop.engine as unknown as { settle: () => void }).settle = () => {};
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) noop.tick(1 / 60);
    const cpuMs = performance.now() - t1;
    const settleMs = fullMs - cpuMs;
    console.log(
      `fullMs=${fullMs.toFixed(0)} cpuMs=${cpuMs.toFixed(0)} settleMs=${settleMs.toFixed(0)}`,
    );
    const wasmWorthIt = cpuMs > settleMs;
    if (cpuMs < settleMs) {
      console.log('GATE: settle-dominated, stop B');
    } else {
      console.log('GATE: cpu-dominated, proceed');
    }
    console.log(`wasmWorthIt=${wasmWorthIt}`);
    expect(fullMs).toBeGreaterThan(0);
  }, 30000);
});
