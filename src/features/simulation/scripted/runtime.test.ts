import { afterEach, describe, expect, it } from 'vitest';
import {
  createScriptedRuntime,
  SCRIPT_BUDGET_MS,
  type ScriptedPart,
  type ScriptedRuntime,
} from './runtime';

/**
 * The runtime alone: no bench, no solver, no file format.
 *
 * Every leg here is about one of the promises the design makes -- the host's
 * clock, a seeded PRNG, a budget, and a fault that latches instead of turning
 * into a plausible number.
 */
describe('the scripted runtime', () => {
  let runtime: ScriptedRuntime | null = null;

  afterEach(() => {
    runtime?.dispose();
    runtime = null;
  });

  const analog = (script: string, id = 'probe'): ScriptedPart => ({ id, script, bus: 'analog' });
  const digital = (script: string, id = 'probe'): ScriptedPart => ({ id, script, bus: 'digital' });

  it('answers from the knobs the operator holds', async () => {
    runtime = await createScriptedRuntime();
    const part = analog('({ analog: ({ knobs }) => knobs.moisture / 100 })');

    expect(runtime.read(part, 0, { moisture: 25 })).toEqual({ value: 0.25, fault: null });
    expect(runtime.read(part, 0, { moisture: 75 })).toEqual({ value: 0.75, fault: null });
  });

  it('takes its clock from the solver, not the machine', async () => {
    runtime = await createScriptedRuntime();
    const part = analog(
      '({ analog: ({ timeMs }) => (Date.now() === timeMs && new Date().getTime() === timeMs ? 1 : 0) })',
    );

    expect(runtime.read(part, 12_345, {})).toEqual({ value: 1, fault: null });
    expect(runtime.read(part, 90_001, {})).toEqual({ value: 1, fault: null });
  });

  it('seeds Math.random, so the same run settles the same way', async () => {
    const first = await createScriptedRuntime({ seed: 7 });
    const second = await createScriptedRuntime({ seed: 7 });
    const third = await createScriptedRuntime({ seed: 8 });
    try {
      const part = analog('({ analog: () => Math.random() })');
      const a = [1, 2, 3].map(() => first.read(part, 0, {}).value);
      const b = [1, 2, 3].map(() => second.read(part, 0, {}).value);
      const c = [1, 2, 3].map(() => third.read(part, 0, {}).value);
      expect(b).toEqual(a);
      expect(c).not.toEqual(a);
      for (const value of a) expect(value).toBeGreaterThanOrEqual(0);
      for (const value of a) expect(value).toBeLessThanOrEqual(1);
    } finally {
      first.dispose();
      second.dispose();
      third.dispose();
    }
  });

  it('latches a throw instead of retrying it every call', async () => {
    runtime = await createScriptedRuntime();
    // Throws once, then would happily answer -- proof the second read is not a
    // retry, because a retry would return 0.5.
    const part = analog(`
      (() => {
        let calls = 0;
        return { analog: () => { calls += 1; if (calls === 1) throw new Error('probe is not fitted'); return 0.5; } };
      })()
    `);

    const first = runtime.read(part, 0, {});
    expect(first.value).toBeUndefined();
    expect(first.fault).toContain('probe is not fitted');

    const second = runtime.read(part, 10, {});
    expect(second.value).toBeUndefined();
    expect(second.fault).toBe(first.fault);
  });

  it('refuses a return the bus cannot carry', async () => {
    runtime = await createScriptedRuntime();
    expect(runtime.read(analog("({ analog: () => 'warm' })"), 0, {}).fault).toContain(
      'from 0 to 1',
    );
    expect(runtime.read(analog('({ analog: () => 1.5 })'), 0, {}).fault).toContain('from 0 to 1');
    expect(runtime.read(digital('({ digital: () => 0.5 })'), 0, {}).fault).toContain('0 or 1');
    expect(runtime.read(digital('({ digital: () => 1 })'), 0, {})).toEqual({
      value: 1,
      fault: null,
    });
  });

  it('stops a script that spins, and leaves the other parts alone', async () => {
    runtime = await createScriptedRuntime();
    const spinner = analog('({ analog: () => { while (true) {} } })', 'spinner');
    const healthy = analog('({ analog: () => 0.5 })', 'healthy');

    const started = performance.now();
    const spun = runtime.read(spinner, 0, {});
    expect(performance.now() - started).toBeLessThan(1000);
    expect(spun.value).toBeUndefined();
    expect(spun.fault).toContain('overran');
    expect(SCRIPT_BUDGET_MS).toBe(2);

    expect(runtime.read(healthy, 0, {})).toEqual({ value: 0.5, fault: null });
  });

  it('reports a script that does not load, or has no entry for its bus', async () => {
    runtime = await createScriptedRuntime();
    const broken = runtime.read(analog('({ analog: () => '), 0, {});
    expect(broken.value).toBeUndefined();
    expect(broken.fault).toContain('did not load');

    const wrongBus = runtime.read(analog('({ digital: () => 1 })'), 0, {});
    expect(wrongBus.fault).toContain('no analog function');
  });

  it('accepts a module-shaped script as well as a bare expression', async () => {
    runtime = await createScriptedRuntime();
    const part = analog('export default { analog: ({ timeMs }) => (timeMs > 0 ? 0.2 : 0.1) };');
    expect(runtime.read(part, 0, {})).toEqual({ value: 0.1, fault: null });
    expect(runtime.read(part, 5, {})).toEqual({ value: 0.2, fault: null });
  });
});
