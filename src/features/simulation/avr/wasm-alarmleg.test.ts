import { describe, expect, it } from 'vitest';

describe('alarm leg', () => {
  it('reads live glass on the reference path', async () => {
    const { cpuGateMeasured } = await import('./wasm-core');
    const r = await cpuGateMeasured();
    expect(typeof r.glass).toBe('string');
    expect(r.glass.length).toBeGreaterThan(0);
    expect(r.measured).toBe(false);
  }, 120000);

  it('matches attached runs glass-for-glass with live probe', async () => {
    const { Simulation } = await import('@/features/bench/simulations/simulation');
    const { boardOption } = await import('@/features/learn/boardRegistry');
    const { firmwareForBuild, galleryById, buildFor } = await import('@/features/learn/gallery');
    const { liveProbe, convergeGlass } = await import('@/features/learn/diagnostics/probes');
    const { hexForSourcesHash, sourcesHashForProject, parseIntelHex } = await import('./hex');
    const { readFileSync } = await import('node:fs');

    async function buildSim() {
      const proj = galleryById('alarm-clock')!;
      const build = buildFor(proj, 'uno', 'library')!;
      const fw = firmwareForBuild(build, 'arduino-cpp');
      const board = boardOption('uno').make();
      const sim = new Simulation(board);
      (sim as unknown as { execution: string }).execution = 'avr';
      sim.loadCircuit(build.circuit);
      sim.loadFirmware(fw);
      return { sim, fw };
    }

    // JS reference: same 60-tick construction as cpuGateMeasured.
    const js = await buildSim();
    js.sim.start();
    for (let i = 0; i < 60; i++) js.sim.tick(1 / 60);
    const jsProbe = liveProbe(js.sim);
    convergeGlass(jsProbe, 70);
    const glassJs = jsProbe.readGlass().text;
    const serialJs = js.sim.serialLines().join('');
    expect(typeof glassJs).toBe('string');
    expect(glassJs.length).toBeGreaterThan(0);

    // Attached path: second Simulation with the real Wasm module.
    const at = await buildSim();
    const backend = (at.sim as unknown as { avrBackend: { attachWasm(c: unknown): void } | null })
      .avrBackend;
    expect(backend, 'alarm AVR core flashed').not.toBeNull();
    const hexText = hexForSourcesHash(sourcesHashForProject(at.fw));
    expect(hexText, 'committed HEX matches staged sources').not.toBeNull();
    const words = parseIntelHex(hexText!);
    const bytes = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
    const mod = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(mod, {});
    const ex = instance.exports as unknown as {
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
    ex.reset_cpu();
    const len = Math.min(words.length, 512);
    new Uint16Array(ex.memory.buffer, ex.flash_base(), len).set(words.subarray(0, len));
    let traps = 0;
    const origStep = ex.step.bind(ex);
    const counting = {
      step: (n: number): number => {
        const r = origStep(n);
        if (r !== -1) traps += 1;
        return r;
      },
      getPc: (): number => ex.get_pc(),
      setPc: (v: number): void => ex.set_pc(v),
      getReg: (i: number): number => ex.get_reg(i),
      setReg: (i: number, v: number): void => ex.set_reg(i, v),
      getSreg: (): number => ex.get_sreg(),
      setSreg: (v: number): void => ex.set_sreg(v),
    };
    backend!.attachWasm(counting as never);
    at.sim.start();
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) at.sim.tick(1 / 60);
    const wallMs = performance.now() - t0;
    const atProbe = liveProbe(at.sim);
    convergeGlass(atProbe, 70);
    const glassAt = atProbe.readGlass().text;
    const serialAt = at.sim.serialLines().join('');
    console.log(`leg=alarm traps=${traps} wallMs=${wallMs.toFixed(0)} glass=${glassAt}`);
    expect(typeof glassAt).toBe('string');
    expect(glassAt.length).toBeGreaterThan(0);
    expect(glassAt).toBe(glassJs);
    expect(serialAt).toBe(serialJs);
  }, 240000);
});
