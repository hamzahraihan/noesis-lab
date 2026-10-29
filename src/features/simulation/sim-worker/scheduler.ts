/** Simulated milliseconds advanced by one fixed-size simulation step. */
export const TICK_MS = 16;

/** Maximum synchronous simulation steps before the worker yields to messages. */
export const MAX_BATCH_STEPS = 8;

/** Existing paced-mode simulated-time budget; Max advances this many per slice. */
export function stepBudgetMs(speed: 'realtime' | 'fast' | 'max'): number {
  return speed === 'fast' ? TICK_MS * 2 : TICK_MS;
}

/**
 * Runs a bounded group of simulation steps and publishes once at the batch
 * boundary. `shouldContinue` is checked between steps so pause/debug state can
 * stop the batch without waiting for its full limit.
 */
export function runStepBatch(
  step: () => void,
  shouldContinue: () => boolean,
  publish: (steps: number) => void,
): number {
  let steps = 0;
  while (steps < MAX_BATCH_STEPS && shouldContinue()) {
    step();
    steps += 1;
  }
  if (steps > 0) publish(steps);
  return steps;
}
