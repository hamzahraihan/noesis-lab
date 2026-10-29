import { describe, expect, it, vi } from 'vitest';
import { MAX_BATCH_STEPS, runStepBatch, stepBudgetMs, TICK_MS } from './scheduler';

describe('maximum-throughput worker scheduler', () => {
  it('preserves realtime and 2× clock pacing budgets', () => {
    expect(stepBudgetMs('realtime')).toBe(TICK_MS);
    expect(stepBudgetMs('fast')).toBe(TICK_MS * 2);
    expect(stepBudgetMs('max')).toBe(TICK_MS);
  });

  it('runs only a bounded batch and publishes once at its boundary', () => {
    const step = vi.fn();
    const publish = vi.fn();

    const steps = runStepBatch(step, () => true, publish);

    expect(steps).toBe(MAX_BATCH_STEPS);
    expect(step).toHaveBeenCalledTimes(MAX_BATCH_STEPS);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(MAX_BATCH_STEPS);
  });

  it('yields as soon as pause or debugger state stops further steps', () => {
    let mayContinue = true;
    let count = 0;
    const publish = vi.fn();

    const steps = runStepBatch(
      () => {
        count += 1;
        if (count === 3) mayContinue = false;
      },
      () => mayContinue,
      publish,
    );

    expect(steps).toBe(3);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(3);
  });

  it('does not publish when the worker is already paused', () => {
    const publish = vi.fn();

    expect(runStepBatch(vi.fn(), () => false, publish)).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });
});
