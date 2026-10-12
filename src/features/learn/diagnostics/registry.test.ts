import { describe, expect, it } from 'vitest';
import { GALLERY } from '../gallery';
import { buildRegistry } from './registry';
import { ZERO_GLYPH } from './probes';

describe('registry', () => {
  it('covers every gallery project and build', () => {
    const expected = GALLERY.flatMap((entry) =>
      entry.builds.map((build) => `${entry.id}@${build.board}${build.variant === undefined ? '' : `:${build.variant}`}`),
    );
    const actual = buildRegistry().map((entry) => `${entry.projectId}@${entry.buildLabel}`);
    expect(actual.sort()).toEqual(expected.sort());
    for (const entry of buildRegistry()) {
      expect(entry.checks.length, `${entry.projectId} checks`).toBeGreaterThan(0);
    }
  });

  it('shows midnight on the raw alarm glass after five ticks', () => {
    const entry = buildRegistry().find(
      (candidate) => candidate.projectId === 'alarm-clock' && candidate.buildLabel === 'uno',
    )!;
    const sim = entry.makeSim();
    for (let frame = 0; frame < 5; frame++) sim.tick(0.05);
    expect(sim.glass().glyphs).toEqual([ZERO_GLYPH, ZERO_GLYPH, ZERO_GLYPH, ZERO_GLYPH]);
  });
});
