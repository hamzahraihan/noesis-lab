import { describe, expect, it } from 'vitest';
import { EXERCISES } from './exercises';

/**
 * Every exercise has to have a worked solution, and it has to match its own
 * wiring table.
 *
 * The second half is the part that rots. A solution explains why a jumper goes
 * where it goes, which is only any use if it is talking about the jumper the
 * exercise actually has. Wiring tables get edited -- a pin moves, a third button
 * is added -- and a solution left naming the old one is worse than no solution,
 * because it is confident and wrong.
 */

describe('worked solutions', () => {
  it('gives every exercise one', () => {
    const missing = EXERCISES.filter((exercise) => exercise.solution === undefined).map(
      (exercise) => exercise.id,
    );
    expect(missing, 'every exercise has a worked solution').toEqual([]);
  });

  it('answers all four questions for each', () => {
    for (const exercise of EXERCISES) {
      const solution = exercise.solution!;
      expect(solution.approach.length, `${exercise.id} approach`).toBeGreaterThan(0);
      expect(solution.wiring.length, `${exercise.id} wiring`).toBeGreaterThan(0);
      expect(solution.working.length, `${exercise.id} working`).toBeGreaterThan(0);
      expect(solution.traps.length, `${exercise.id} traps`).toBeGreaterThan(0);
    }
  });

  it('explains every jumper the exercise asks for, and no others', () => {
    for (const exercise of EXERCISES) {
      const wired = exercise.wiring.map((wire) => `${wire.pin}:${wire.terminal}`);
      const explained = exercise.solution!.wiring.map((wire) => `${wire.pin}:${wire.terminal}`);

      expect(
        explained,
        `${exercise.id} covers its wiring table exactly`,
      ).toEqual(wired);
    }
  });

  it('gives the reasoning rather than restating the destination', () => {
    for (const exercise of EXERCISES) {
      for (const wire of exercise.solution!.wiring) {
        expect(
          wire.why.trim().length,
          `${exercise.id} ${wire.pin} explains rather than points`,
        ).toBeGreaterThan(30);
      }
    }
  });
});
