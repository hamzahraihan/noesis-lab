import { describe, expect, it } from 'vitest';
import { buildIndexObjects, selectIndexRelease } from './index-build';
import type { IndexLibrary } from './index';

const lib: IndexLibrary = {
  name: 'SevSeg', author: 'A', sentence: 's', category: 'Display', architectures: ['*'],
  providesIncludes: ['SevSeg.h'],
  versions: [
    { version: '3.2.0', url: 'u32', checksum: 'SHA-256:' + 'a'.repeat(64), size: 10 },
    { version: '3.1.0', url: 'u31', checksum: 'SHA-256:' + 'b'.repeat(64), size: 10 },
  ],
};

describe('index entry builds', () => {
  it('selects pinned, latest, or null without fetching', () => {
    expect(selectIndexRelease(lib)?.version).toBe('3.2.0');
    expect(selectIndexRelease(lib, '3.1.0')?.version).toBe('3.1.0');
    expect(selectIndexRelease(lib, '0.0.0-nope')).toBeNull();
  });

  it('refuses checksum mismatches with nothing cached', async () => {
    const puts: string[] = [];
    let fetches = 0;
    const deps = {
      fetch: async () => {
        fetches += 1;
        return new Uint8Array([0]);
      },
      cache: { get: async () => null, put: async (key: string) => { puts.push(key); } },
      compileUnit: async () => new Uint8Array([1]),
    };
    const bad = { ...lib, versions: [{ version: '9.9.9', url: 'u', checksum: 'SHA-256:' + '0'.repeat(64), size: 1 }] };
    await expect(
      buildIndexObjects({ name: 'SevSeg', release: bad.versions[0] }, deps),
    ).rejects.toThrow(/checksum mismatch/);
    expect(puts).toEqual([]);
    expect(fetches).toBe(1);
  });
});
