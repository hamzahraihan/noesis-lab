import { describe, expect, it } from 'vitest';
import { buildRegistry } from './registry';
import { runHarness } from './harness';
import { FIVE_GLYPH, ONE_GLYPH, ZERO_GLYPH } from './probes';
import { GALLERY_PROJECT_IDS, GALLERY_BUILD_LABELS, NETWORK_PROJECT_IDS } from '../generated/test-coverage';
import { GALLERY } from '../gallery';

describe('registry', () => {
  it('covers every gallery project and build', () => {
    const expected = [...GALLERY_BUILD_LABELS];
    const actual = buildRegistry().map((entry) => `${entry.projectId}@${entry.buildLabel}`);
    expect(actual.sort()).toEqual(expected.sort());
    for (const entry of buildRegistry()) {
      expect(entry.checks.length, `${entry.projectId} checks`).toBeGreaterThan(0);
    }
    expect(
      [...new Set(buildRegistry().map((entry) => entry.projectId))].sort(),
    ).toEqual([...GALLERY_PROJECT_IDS].sort());
  });

  /*
   * Every interpreter build's checks run here. They used to be picked by hand
   * from a six-id list in the generator, so the other forty-six projects had
   * checks that typechecked and never executed -- which is how five broken
   * checks survived long enough to be found by running them.
   *
   * Those five were real defects in the devices and the sketches, not in the
   * wiring: a stepper's shaft compared against a counter the sketch nets out, a
   * pin asked for by its alias, and three sensors whose registers were shifted
   * twice. They are fixed, so the leg asserts every project rather than listing
   * exceptions.
   */
  it('passes its live checks for every interpreter project', async () => {
    const interpreterBuilds = buildRegistry().filter((entry) => {
      const build = GALLERY.find((p) => p.id === entry.projectId)?.builds.find(
        (b) => (b.variant === undefined ? b.board : `${b.board}:${b.variant}`) === entry.buildLabel,
      );
      return build?.execution === undefined || build.execution === 'interpreter';
    });
    // Guards the leg against silently shrinking to nothing again.
    expect(interpreterBuilds.length).toBeGreaterThan(40);

    // Every failure is collected rather than stopping at the first: a leg that
    // reports one project at a time sends the reader back for each, and the
    // point of running them all is to see the whole set at once.
    const failures: string[] = [];
    for (const entry of interpreterBuilds) {
      const report = await runHarness(entry.checks, entry.makeSim, {
        wallCapMs: entry.extendedCapMs,
      });
      for (const result of report.results) {
        if (result.status === 'fail') {
          failures.push(`${entry.projectId}@${entry.buildLabel}: ${result.name} -- ${result.detail}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 600_000);

  it('keeps the network projects on their offline half', async () => {
    /*
     * live-weather's checks are the offline half of that project on purpose:
     * the harness builds a bench with no live bridge, so they pin the join and
     * the reported failure rather than a third party's answer. The projects that
     * speak on a real network are the ESP32 ones, which run in the worker.
     */
    for (const id of NETWORK_PROJECT_IDS) {
      const entry = buildRegistry().find((candidate) => candidate.projectId === id)!;
      expect(entry.checks.length, `${id} checks`).toBeGreaterThan(0);
    }
  });

  it('shows 15:00 on the driven alarm glass', () => {
    const entry = buildRegistry().find(
      (candidate) => candidate.projectId === 'alarm-clock' && candidate.buildLabel === 'uno',
    )!;
    const sim = entry.makeSim();
    for (let frame = 0; frame < 120; frame++) sim.tick(0.05);
    expect(sim.glass().glyphs).toEqual([ONE_GLYPH, FIVE_GLYPH, ZERO_GLYPH, ZERO_GLYPH]);
  }, 60000);

  it('takes the long wall cap from the build that needs it', () => {
    const library = buildRegistry().find(
      (candidate) => candidate.projectId === 'alarm-clock' && candidate.buildLabel === 'uno:library',
    )!;
    expect(library.extendedCapMs).toBe(1_600_000);
    const plain = buildRegistry().find(
      (candidate) => candidate.projectId === 'alarm-clock' && candidate.buildLabel === 'uno',
    )!;
    expect(plain.extendedCapMs).toBeUndefined();
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