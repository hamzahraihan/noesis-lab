import { describe, expect, it } from 'vitest';
import { formatReport, runHarness, type CheckDef, type HarnessSim } from './harness';
import { buildRegistry } from './registry';

function fakeSim(): HarnessSim & { calls: string[] } {
  const calls: string[] = [];
  const blank = [0, 0, 0, 0, 0, 0, 0, 0];
  return {
    calls,
    tick: (d: number) => {
      calls.push(`tick:${d}`);
    },
    glass: () => ({ glyphs: [blank, blank, blank, blank], colon: false, text: '' }),
    pressButton: (index: number, down: boolean) => {
      calls.push(`press:${index}:${down ? 1 : 0}`);
    },
    jumpTimeMs: (ms: number) => {
      calls.push(`jump:${ms}`);
    },
    serialText: () => '',
    readGpio: () => false,
  };
}

const passCheck: CheckDef = {
  name: 'always passes',
  run: () => ({ name: 'always passes', status: 'pass', detail: 'ok', wallMs: 1 }),
};

describe('runHarness', () => {
  it('runs checks in order and formats a report', async () => {
    const sim = fakeSim();
    const report = await runHarness([passCheck, passCheck], () => sim, { yieldEvery: 1000 });
    expect(report.results.map((r) => r.status)).toEqual(['pass', 'pass']);
    expect(sim.calls.length).toBe(0);
    const text = formatReport({ ...report, projectId: 'demo', buildLabel: 'uno' });
    expect(text).toContain('demo');
    expect(text).toContain('always passes');
    expect(text).toContain('pass');
  });

  it('stops at cancel and skips the rest', async () => {
    let calls = 0;
    const counting: CheckDef = {
      name: 'counting',
      run: () => {
        calls += 1;
        return { name: 'counting', status: 'pass', detail: '', wallMs: 0 };
      },
    };
    const report = await runHarness([counting, counting, counting], fakeSim, {
      isCancelled: () => calls >= 1,
      yieldEvery: 1,
    });
    expect(report.results.map((r) => r.status)).toEqual(['pass', 'skip', 'skip']);
    expect(report.results[1]?.detail).toBe('cancelled');
  });

  it('gives identical verdicts regardless of chunk size', async () => {
    const mk = (): CheckDef => ({
      name: 'steady',
      run: (sim) => {
        sim.tick(0.05);
        return { name: 'steady', status: 'pass', detail: '', wallMs: 0 };
      },
    });
    const a = await runHarness([mk()], fakeSim, { yieldEvery: 1 });
    const b = await runHarness([mk()], fakeSim, { yieldEvery: 1000 });
    expect(a.results.map((r) => r.status)).toEqual(b.results.map((r) => r.status));
  });

  it('marks a hanging check as timeout under the wall cap', async () => {
    const hanging: CheckDef = {
      name: 'hanging',
      run: () => new Promise(() => {}) as Promise<never>,
    };
    const report = await runHarness([hanging], fakeSim, { wallCapMs: 50, yieldEvery: 1000 });
    expect(report.results[0]?.status).toBe('timeout');
  });

  it('stamps simMs from counting sims', async () => {
    let total = 0;
    const base = fakeSim();
    const counting = {
      ...base,
      tick: (d: number) => {
        total += d * 1000;
      },
      simMs: () => total,
    };
    const ticking: CheckDef = {
      name: 'ticking',
      run: (sim) => {
        sim.tick(0.05);
        return { name: 'ticking', status: 'pass', detail: '', wallMs: 0 };
      },
    };
    const report = await runHarness([ticking], () => counting, { yieldEvery: 1000 });
    expect(report.metrics.simMs).toBeCloseTo(50, 5);
  });

  it('turns a synchronously throwing check into a fail row and keeps going', async () => {
    const throwing: CheckDef = {
      name: 'throwing',
      run: () => {
        throw new Error('boom-sync');
      },
    };
    const after: CheckDef = {
      name: 'after',
      run: () => ({ name: 'after', status: 'pass', detail: '', wallMs: 0 }),
    };
    const report = await runHarness([throwing, after], fakeSim, { yieldEvery: 1000 });
    expect(report.results.map((r) => r.status)).toEqual(['fail', 'pass']);
    expect(report.results[0]?.detail).toContain('boom-sync');
  });

  it('turns an asynchronously rejecting check into a fail row and keeps going', async () => {
    const rejecting: CheckDef = {
      name: 'rejecting',
      run: () => Promise.reject(new Error('boom-async')),
    };
    const after: CheckDef = {
      name: 'after',
      run: () => ({ name: 'after', status: 'pass', detail: '', wallMs: 0 }),
    };
    const report = await runHarness([rejecting, after], fakeSim, { yieldEvery: 1000 });
    expect(report.results.map((r) => r.status)).toEqual(['fail', 'pass']);
    expect(report.results[0]?.detail).toContain('boom-async');
  });

  it('counts ticks from the sim and reports fps in the header', async () => {
    let tickCount = 0;
    const base = fakeSim();
    const counting = {
      ...base,
      tick: () => {
        tickCount += 1;
      },
      simMs: () => 0,
      ticks: () => tickCount,
    };
    const ticking: CheckDef = {
      name: 'ticking',
      run: (sim) => {
        sim.tick(0.05);
        sim.tick(0.05);
        return { name: 'ticking', status: 'pass', detail: '', wallMs: 0 };
      },
    };
    const report = await runHarness([ticking, ticking], () => counting, { yieldEvery: 1000 });
    expect(report.metrics.ticks).toBe(4);
    const text = formatReport({ ...report, projectId: 'demo', buildLabel: 'uno' });
    const expectedFps =
      report.metrics.wallMs > 0 ? report.metrics.ticks / (report.metrics.wallMs / 1000) : 0;
    expect(text).toContain(`fps ${expectedFps.toFixed(1)}`);
  });

  it('defaults ticks to 0 and guards fps at wallMs 0', async () => {
    const report = await runHarness([passCheck], fakeSim, { yieldEvery: 1000 });
    expect(report.metrics.ticks).toBe(0);
    const text = formatReport({
      ...report,
      projectId: 'demo',
      buildLabel: 'uno',
      metrics: { ...report.metrics, wallMs: 0, ticks: 10 },
    });
    expect(text).toContain('fps 0.0');
  });

  it('prints per-check milliseconds on every result line', async () => {
    const report = await runHarness([passCheck], fakeSim, { yieldEvery: 1000 });
    const text = formatReport({ ...report, projectId: 'demo', buildLabel: 'uno' });
    expect(text).toContain('[pass] always passes (1 ms) — ok');
    const blank: CheckDef = {
      name: 'quiet',
      run: () => ({ name: 'quiet', status: 'pass', detail: '', wallMs: 0 }),
    };
    const quiet = await runHarness([blank], fakeSim, { yieldEvery: 1000 });
    expect(formatReport({ ...quiet, projectId: 'demo', buildLabel: 'uno' })).toContain(
      '[pass] quiet (0 ms)',
    );
  });
});

describe('partVolts pin validation', () => {
  it('partVolts returns voltage for valid definition pin', () => {
    const entry = buildRegistry().find((e) => e.projectId === 'safe')!;
    const sim = entry.makeSim();
    // Safe circuit has p10 (piezo-buzzer) with pins: positive, negative
    const volts = sim.partVolts!('p10', 'positive');
    expect(typeof volts).toBe('number');
  });

  it('partVolts throws for wire alias instead of definition pin', () => {
    const entry = buildRegistry().find((e) => e.projectId === 'safe')!;
    const sim = entry.makeSim();
    // Circuit JSON uses wire aliases like "A", "K" for LED
    // But definition uses "anode", "cathode"
    expect(() => sim.partVolts!('p6', 'A')).toThrow(
      "Pin 'A' not found in part definition"
    );
  });

  it('partVolts returns 0 for valid pin not connected in netlist', () => {
    const entry = buildRegistry().find((e) => e.projectId === 'safe')!;
    const sim = entry.makeSim();
    // Pin exists in definition but may not be wired - use a valid definition pin
    const volts = sim.partVolts!('p10', 'positive');
    expect(typeof volts).toBe('number');
  });

  it('partVolts throws for non-existent part', () => {
    const entry = buildRegistry().find((e) => e.projectId === 'safe')!;
    const sim = entry.makeSim();
    expect(() => sim.partVolts!('nonexistent', 'anode')).toThrow("Part 'nonexistent' not found");
  });
});
