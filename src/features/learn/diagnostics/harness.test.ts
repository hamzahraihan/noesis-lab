import { describe, expect, it } from 'vitest';
import { formatReport, runHarness, type CheckDef, type HarnessSim } from './harness';

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
});
