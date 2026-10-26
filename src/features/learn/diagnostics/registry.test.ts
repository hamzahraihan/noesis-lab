import { describe, expect, it } from 'vitest';
import { GALLERY } from '../gallery';
import { buildRegistry } from './registry';
import { runHarness } from './harness';
import { FIVE_GLYPH, ONE_GLYPH, ZERO_GLYPH } from './probes';

describe('registry', () => {
  it('covers every gallery project and build', () => {
    const expected = GALLERY.flatMap((entry) =>
      entry.builds.map(
        (build) =>
          `${entry.id}@${build.board}${build.variant === undefined ? '' : `:${build.variant}`}`,
      ),
    );
    const actual = buildRegistry().map((entry) => `${entry.projectId}@${entry.buildLabel}`);
    expect(actual.sort()).toEqual(expected.sort());
    for (const entry of buildRegistry()) {
      expect(entry.checks.length, `${entry.projectId} checks`).toBeGreaterThan(0);
    }
  });

  /*
   * The checks are live-acceptance code, so at least the fast ones are run
   * here: a check that cannot pass is worse than no check, and the registry's
   * coverage test cannot see the difference.
   */
  it('passes its live checks for the network projects', async () => {
    /*
     * live-weather's checks are the offline half of that project on purpose:
     * the harness builds a bench with no live bridge, so they pin the join and
     * the reported failure rather than a third party's answer.
     */
    for (const id of ['net-clock', 'sensor-feed', 'net-weather', 'live-weather'] as const) {
      const entry = buildRegistry().find((candidate) => candidate.projectId === id)!;
      const report = await runHarness(entry.checks, entry.makeSim);
      const failed = report.results.filter((result) => result.status === 'fail');
      expect(failed, `${id}: ${failed.map((result) => result.detail).join('; ')}`).toEqual([]);
      expect(
        report.results.every((result) => result.status === 'pass'),
        id,
      ).toBe(true);
    }
  }, 30_000);

  it('passes its live checks for the new part projects', async () => {
    for (const id of ['ds3231', 'mcp23017', 'pca9685', 'microstep', 'environment-bench'] as const) {
      const entry = buildRegistry().find((candidate) => candidate.projectId === id)!;
      const report = await runHarness(entry.checks, entry.makeSim);
      const failed = report.results.filter((result) => result.status === 'fail');
      expect(failed, `${id}: ${failed.map((result) => result.detail).join('; ')}`).toEqual([]);
      expect(
        report.results.every((result) => result.status === 'pass'),
        id,
      ).toBe(true);
    }
  }, 30_000);

  it('shows 15:00 on the driven alarm glass', () => {
    const entry = buildRegistry().find(
      (candidate) => candidate.projectId === 'alarm-clock' && candidate.buildLabel === 'uno',
    )!;
    const sim = entry.makeSim();
    for (let frame = 0; frame < 120; frame++) sim.tick(0.05);
    expect(sim.glass().glyphs).toEqual([ONE_GLYPH, FIVE_GLYPH, ZERO_GLYPH, ZERO_GLYPH]);
  }, 60000);

  it('extends the wall cap on the alarm-clock library entry only', () => {
    for (const entry of buildRegistry()) {
      if (entry.projectId === 'alarm-clock' && entry.buildLabel === 'uno:library') {
        expect(entry.extendedCapMs).toBe(1_600_000);
      } else {
        expect(entry.extendedCapMs).toBeUndefined();
      }
    }
  });

  it('counts ticks through the adapter', () => {
    const entry = buildRegistry().find(
      (candidate) => candidate.projectId === 'alarm-clock' && candidate.buildLabel === 'uno',
    )!;
    const sim = entry.makeSim();
    sim.tick(0.05);
    sim.tick(0.05);
    expect(sim.ticks?.()).toBe(2);
  });
});
