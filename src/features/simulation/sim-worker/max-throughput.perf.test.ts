import { describe, expect, it } from 'vitest';
import { boardOption } from '@/features/learn/boardRegistry';
import { createSimCore } from './core';
import { runStepBatch, TICK_MS } from './scheduler';

function measure(batched: boolean): { stepsPerSecond: number; simulatedMs: number; snapshots: number } {
  const core = createSimCore(boardOption('uno').make());
  core.rebuild(
    { parts: [], wires: [], terminals: [] } as never,
    {
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
    } as never,
    'interpreter',
  );
  const targetSteps = 600;
  let steps = 0;
  let snapshots = 0;
  const startedAt = performance.now();
  if (batched) {
    while (steps < targetSteps) {
      runStepBatch(
        () => {
          core.step(TICK_MS);
          steps += 1;
        },
        () => steps < targetSteps,
        () => {
          core.snapshot();
          snapshots += 1;
        },
      );
    }
  } else {
    while (steps < targetSteps) {
      core.step(TICK_MS);
      core.snapshot();
      steps += 1;
      snapshots += 1;
    }
  }
  const elapsedMs = performance.now() - startedAt;
  return { stepsPerSecond: (targetSteps * 1000) / elapsedMs, simulatedMs: core.timeMs, snapshots };
}

describe('Max throughput experiment', () => {
  it('compares per-step snapshots with bounded batch snapshots', () => {
    // Warm both paths once to avoid including module/JIT startup in either result.
    measure(false);
    measure(true);

    const runs = Array.from({ length: 5 }, () => ({
      baseline: measure(false),
      max: measure(true),
    }));
    const median = (values: number[]): number =>
      [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0;
    const baseline = median(runs.map((run) => run.baseline.stepsPerSecond));
    const max = median(runs.map((run) => run.max.stepsPerSecond));
    console.log(
      JSON.stringify({
        baselineStepsPerSecond: baseline,
        maxStepsPerSecond: max,
        speedup: max / baseline,
        snapshotsPerRun: { baseline: 600, max: 75 },
      }),
    );
    expect(runs.every((run) => run.max.simulatedMs === run.baseline.simulatedMs)).toBe(true);
    expect(runs.every((run) => run.max.snapshots < run.baseline.snapshots)).toBe(true);
  });
});
