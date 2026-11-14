/**
 * Helpers and types every project's checks share.
 *
 * Split out of `checks.ts` when the checks moved to one file per project: a
 * helper used by several projects belongs here rather than being copied into
 * each one.
 */

import type { CheckDef, CheckResult, CheckStatus, HarnessSim } from '../harness';
import type { ProbeSim } from '../probes';
import type { GalleryBuild } from '../../gallery';

export type { CheckDef, CheckResult, CheckStatus, HarnessSim, ProbeSim, GalleryBuild };

export function pressAndSettle(sim: HarnessSim, index: number): void {
  sim.pressButton(index, true);
  for (let frame = 0; frame < 4; frame++) sim.tick(0.05);
  sim.pressButton(index, false);
  for (let frame = 0; frame < 4; frame++) sim.tick(0.05);
}

export function verdict(name: string, started: number, status: CheckStatus, detail = ''): CheckResult {
  return { name, status, detail, wallMs: performance.now() - started };
}

export function asProbe(sim: HarnessSim): ProbeSim {
  return {
    tick: (wallDeltaSeconds: number) => sim.tick(wallDeltaSeconds),
    readGlass: () => sim.glass(),
  };
}

export function sameGlyph(actual: readonly number[] | undefined, expected: readonly number[]): boolean {
  return (
    actual !== undefined &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function sameGlass(
  actual: readonly (readonly number[])[],
  expected: readonly (readonly number[])[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((glyph, index) => sameGlyph(glyph, expected[index]!))
  );
}
