import { describe, expect, it } from 'vitest';
import { TIER2_MANIFEST, tier2ByName } from './provided';

describe('tier-2 manifest', () => {
  it('pins exactly SevSeg and RTClib with hashes, urls, licenses, headers', () => {
    expect(TIER2_MANIFEST.map((entry) => entry.name)).toEqual(['SevSeg', 'RTClib']);
    for (const entry of TIER2_MANIFEST) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.license.length).toBeGreaterThan(0);
      expect(entry.headers.length).toBeGreaterThan(0);
    }
    expect(TIER2_MANIFEST.find((e) => e.name === 'SevSeg')?.headers).toContain('SevSeg.h');
    expect(TIER2_MANIFEST.find((e) => e.name === 'RTClib')?.headers).toContain('RTClib.h');
  });

  it('resolves pinned or unversioned requests and refuses the rest by name', () => {
    expect(tier2ByName('SevSeg')?.name).toBe('SevSeg');
    expect(tier2ByName('SevSeg', TIER2_MANIFEST[0].version)?.name).toBe('SevSeg');
    expect(tier2ByName('SevSeg', '0.0.0-nonexistent')).toBeNull();
    expect(tier2ByName('Nope')).toBeNull();
  });
});
