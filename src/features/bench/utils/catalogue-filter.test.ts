import { describe, expect, it } from 'vitest';
import { PART_CATALOGUE } from '@/features/parts';
import { matchCatalogue } from './catalogue-filter';

describe('matchCatalogue', () => {
  it('returns the whole catalogue on an empty query', () => {
    expect(matchCatalogue('')).toHaveLength(PART_CATALOGUE.length);
    expect(matchCatalogue('   ')).toHaveLength(PART_CATALOGUE.length);
  });

  it('matches case-insensitively across name, note and id', () => {
    const byName = matchCatalogue('resistor');
    expect(byName.length).toBeGreaterThan(0);
    expect(matchCatalogue('RESISTOR').map((e) => e.id)).toEqual(byName.map((e) => e.id));
    // "pull-up" only appears in notes, so id/name matching alone finds nothing.
    expect(matchCatalogue('pull-up').length).toBeGreaterThan(0);
  });

  it('filters by group when one is given', () => {
    const all = matchCatalogue('', 'all');
    const firstGroup = PART_CATALOGUE[0].group;
    const grouped = matchCatalogue('', firstGroup);
    expect(all).toHaveLength(PART_CATALOGUE.length);
    expect(grouped.length).toBeGreaterThan(0);
    expect(grouped.every((e) => e.group === firstGroup)).toBe(true);
  });

  it('combines query and group', () => {
    expect(matchCatalogue('no-such-part-xyz', 'all')).toHaveLength(0);
  });
});
