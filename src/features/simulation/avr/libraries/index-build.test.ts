import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildIndexObjects, reinstallIndexObjects, restoreInstalledIndex, selectIndexRelease } from './index-build';
import { encodeTier2Map, tier2CacheKey } from './tier2';
import { validateLibraries } from './model';
import type { IndexLibrary } from './index';

const lib: IndexLibrary = {
  name: 'SevSeg', author: 'A', sentence: 's', category: 'Display', architectures: ['*'],
  providesIncludes: ['SevSeg.h'],
  versions: [
    { version: '3.2.0', url: 'u32', checksum: 'SHA-256:' + 'a'.repeat(64), size: 10 },
    { version: '3.1.0', url: 'u31', checksum: 'SHA-256:' + 'b'.repeat(64), size: 10 },
  ],
};

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Minimal stored-only zip writer: local headers + central directory + EOCD. */
function buildStoredZip(entries: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, entry.data);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(8, 0, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, entry.data.length, true);
    head.setUint32(22, entry.data.length, true);
    head.setUint16(26, nameBytes.length, true);
    head.setUint32(42, offset, true);
    central.push(new Uint8Array(head.buffer), nameBytes);
    offset += 30 + nameBytes.length + entry.data.length;
  }
  const directory = concat(central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06050b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directory.length, true);
  end.setUint32(16, offset, true);
  return concat([...chunks, directory, new Uint8Array(end.buffer)]);
}

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

  it('serves exact-key hits with zero fetches and zero compiles', async () => {
    const release = lib.versions[0];
    const seedObjects = new Map([['SevSeg.o', new Uint8Array([1, 2, 3])]]);
    const seedHeaders = new Map([['SevSeg.h', new TextEncoder().encode('#pragma once')]]);
    const store = new Map([
      [tier2CacheKey('SevSeg', release.version, 'objects'), encodeTier2Map(seedObjects)],
      [tier2CacheKey('SevSeg', release.version, 'headers'), encodeTier2Map(seedHeaders)],
    ]);
    let fetches = 0;
    let compiles = 0;
    const deps = {
      fetch: async (): Promise<Uint8Array> => {
        fetches += 1;
        return new Uint8Array([0]);
      },
      cache: {
        get: async (key: string): Promise<Uint8Array | null> => store.get(key) ?? null,
        put: async (key: string, value: Uint8Array): Promise<void> => {
          store.set(key, value);
        },
      },
      compileUnit: async (): Promise<Uint8Array> => {
        compiles += 1;
        return new Uint8Array([9]);
      },
    };
    const result = await buildIndexObjects({ name: 'SevSeg', release }, deps);
    expect(fetches).toBe(0);
    expect(compiles).toBe(0);
    expect([...result.objects.entries()]).toEqual([...seedObjects.entries()]);
    expect([...result.headers.entries()]).toEqual([...seedHeaders.entries()]);
  });

  it('rejects unsupported checksum schemes before any fetch', async () => {
    let fetches = 0;
    const deps = {
      fetch: async (): Promise<Uint8Array> => {
        fetches += 1;
        return new Uint8Array([0]);
      },
      cache: {
        get: async (): Promise<Uint8Array | null> => null,
        put: async (): Promise<void> => {},
      },
      compileUnit: async (): Promise<Uint8Array> => new Uint8Array([1]),
    };
    const release = { version: '1.0.0', url: 'u', checksum: 'MD5:abc', size: 1 };
    await expect(
      buildIndexObjects({ name: 'SevSeg', release }, deps),
    ).rejects.toThrow(/unsupported checksum scheme/);
    expect(fetches).toBe(0);
  });

  it('surfaces quota put failures as cache unavailable with nothing half-written', async () => {
    const encoder = new TextEncoder();
    const archive = buildStoredZip([
      { name: 'SevSeg-1.0.0/SevSeg.cpp', data: encoder.encode('#include "SevSeg.h"\nint x = 1;\n') },
      { name: 'SevSeg-1.0.0/SevSeg.h', data: encoder.encode('#pragma once\nint x;\n') },
    ]);
    const sha = createHash('sha256').update(archive).digest('hex');
    const release = { version: '1.0.0', url: 'u', checksum: `SHA-256:${sha}`, size: archive.length };
    const objectsKey = tier2CacheKey('SevSeg', release.version, 'objects');
    const headersKey = tier2CacheKey('SevSeg', release.version, 'headers');
    const store = new Map<string, Uint8Array>();
    const cache = {
      get: async (key: string): Promise<Uint8Array | null> => store.get(key) ?? null,
      put: async (): Promise<void> => {
        throw new Error('quota exceeded');
      },
    };
    let compiles = 0;
    const deps = {
      fetch: async (): Promise<Uint8Array> => archive,
      cache,
      compileUnit: async (): Promise<Uint8Array> => {
        compiles += 1;
        return new Uint8Array([7]);
      },
    };
    await expect(
      buildIndexObjects({ name: 'SevSeg', release }, deps),
    ).rejects.toThrow(/cache unavailable/);
    expect(compiles).toBe(1);
    expect(await cache.get(objectsKey)).toBeNull();
    expect(await cache.get(headersKey)).toBeNull();
  });

  it('reinstall evicts the exact-key hit and refetches instead of no-op', async () => {
    const encoder = new TextEncoder();
    const archive = buildStoredZip([
      { name: 'SevSeg-1.0.0/SevSeg.cpp', data: encoder.encode('#include "SevSeg.h"\nint x = 1;\n') },
      { name: 'SevSeg-1.0.0/SevSeg.h', data: encoder.encode('#pragma once\nint x;\n') },
    ]);
    const sha = createHash('sha256').update(archive).digest('hex');
    const release = { version: '1.0.0', url: 'u', checksum: `SHA-256:${sha}`, size: archive.length };
    // A previous build's bytes behind the exact key: a plain install no-ops on this hit.
    const seedObjects = new Map([['SevSeg.o', new Uint8Array([1, 2, 3])]]);
    const seedHeaders = new Map([['SevSeg.h', encoder.encode('#pragma once')]]);
    const store = new Map([
      [tier2CacheKey('SevSeg', release.version, 'objects'), encodeTier2Map(seedObjects)],
      [tier2CacheKey('SevSeg', release.version, 'headers'), encodeTier2Map(seedHeaders)],
    ]);
    let fetches = 0;
    let compiles = 0;
    const deps = {
      fetch: async (): Promise<Uint8Array> => {
        fetches += 1;
        return archive;
      },
      cache: {
        get: async (key: string): Promise<Uint8Array | null> => store.get(key) ?? null,
        put: async (key: string, value: Uint8Array): Promise<void> => {
          store.set(key, value);
        },
        delete: async (key: string): Promise<void> => {
          store.delete(key);
        },
      },
      compileUnit: async (): Promise<Uint8Array> => {
        compiles += 1;
        return new Uint8Array([7]);
      },
    };
    const hit = await buildIndexObjects({ name: 'SevSeg', release }, deps);
    expect(fetches).toBe(0);
    expect(compiles).toBe(0);
    expect([...hit.objects.values()][0]).toEqual(new Uint8Array([1, 2, 3]));
    // A reinstall evicts first, so it always refetches + rebuilds (spec §2).
    const rebuilt = await reinstallIndexObjects({ name: 'SevSeg', release }, deps);
    expect(fetches).toBe(1);
    expect(compiles).toBe(1);
    expect([...rebuilt.objects.values()][0]).toEqual(new Uint8Array([7]));
    expect([...rebuilt.headers.keys()]).toEqual(['SevSeg.h']);
  });

  it('restores the installed map from the versioned cache for saved declarations', async () => {
    const encoder = new TextEncoder();
    const archive = buildStoredZip([
      { name: 'SevSeg-1.0.0/SevSeg.cpp', data: encoder.encode('#include "SevSeg.h"\nint x = 1;\n') },
      { name: 'SevSeg-1.0.0/SevSeg.h', data: encoder.encode('#pragma once\nint x;\n') },
    ]);
    const sha = createHash('sha256').update(archive).digest('hex');
    const release = { version: '1.0.0', url: 'u', checksum: `SHA-256:${sha}`, size: archive.length };
    const store = new Map<string, Uint8Array>();
    const cache = {
      get: async (key: string): Promise<Uint8Array | null> => store.get(key) ?? null,
      put: async (key: string, value: Uint8Array): Promise<void> => {
        store.set(key, value);
      },
    };
    await buildIndexObjects(
      { name: 'SevSeg', release },
      { fetch: async () => archive, cache, compileUnit: async () => new Uint8Array([7]) },
    );
    // A fresh session holds no installed entries: the declaration alone greys unknown.
    const saved = {
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
      libraries: [{ name: 'SevSeg', source: 'index', version: '1.0.0' } as const],
    } as const;
    expect(validateLibraries(saved, { slots: [], indexInstalled: new Map() })).toEqual([
      '<SevSeg>: unknown index library',
    ]);
    // Rebuilt deterministically from the outliving object cache: validates clean, no reinstall.
    const restored = await restoreInstalledIndex(
      [{ name: 'SevSeg', version: '1.0.0' }],
      cache,
    );
    expect(restored.get('SevSeg')).toEqual({ version: '1.0.0', headers: ['SevSeg.h'] });
    expect(validateLibraries(saved, { slots: [], indexInstalled: restored })).toEqual([]);
    // Unpinned declarations and evicted entries stay unknown until install.
    expect(await restoreInstalledIndex([{ name: 'SevSeg' }], cache)).toEqual(new Map());
    store.clear();
    expect(await restoreInstalledIndex([{ name: 'SevSeg', version: '1.0.0' }], cache)).toEqual(new Map());
  });
});
