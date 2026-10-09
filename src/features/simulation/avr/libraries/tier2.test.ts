import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { TIER2_MANIFEST } from './provided';
import { buildTier2Objects, encodeTier2Map, tier2CacheKey, type Tier2Deps } from './tier2';

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

interface FixtureEntry {
  readonly name: string;
  readonly data: Uint8Array;
  readonly method: 0 | 8;
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

/** Minimal zip writer: local headers + central directory, stored/deflated. */
function buildFixtureZip(entries: readonly FixtureEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const stored = entry.method === 8 ? new Uint8Array(deflateRawSync(entry.data)) : entry.data;
    const crc = crc32(entry.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, entry.method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, stored.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, stored);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(8, entry.method, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, stored.length, true);
    head.setUint32(22, entry.data.length, true);
    head.setUint16(26, nameBytes.length, true);
    head.setUint32(42, offset, true);
    central.push(new Uint8Array(head.buffer), nameBytes);
    offset += 30 + nameBytes.length + stored.length;
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

function stubCache(initial: ReadonlyMap<string, Uint8Array> = new Map()) {
  const store = new Map(initial);
  const puts: string[] = [];
  return {
    puts,
    store,
    cache: {
      get: async (key: string): Promise<Uint8Array | null> => store.get(key) ?? null,
      put: async (key: string, value: Uint8Array): Promise<void> => {
        puts.push(key);
        store.set(key, value);
      },
    },
  };
}

function sevSegZip(): Uint8Array {
  const encoder = new TextEncoder();
  return buildFixtureZip([
    { name: 'SevSeg-3.7.0/SevSeg.cpp', data: encoder.encode('#include "SevSeg.h"\nint x = 1;\n'), method: 8 },
    { name: 'SevSeg-3.7.0/SevSeg.h', data: encoder.encode('#pragma once\nint x;\n'), method: 0 },
  ]);
}

describe('tier-2 build', () => {
  it('refuses checksum mismatches with nothing cached', async () => {
    const puts: string[] = [];
    const deps: Tier2Deps = {
      fetch: async () => new Uint8Array([0]),
      cache: {
        get: async () => null,
        put: async (key: string) => {
          puts.push(key);
        },
      },
      compileUnit: async () => new Uint8Array([1]),
    };
    await expect(buildTier2Objects('SevSeg', undefined, deps)).rejects.toThrow(/checksum mismatch/);
    expect(puts).toEqual([]);
  });

  it('reuses cached objects without refetching', async () => {
    const entry = TIER2_MANIFEST[0];
    const seedObjects = new Map([['SevSeg.o', new Uint8Array([1, 2, 3])]]);
    const seedHeaders = new Map([['SevSeg.h', new TextEncoder().encode('#pragma once')]]);
    const stub = stubCache(
      new Map([
        [tier2CacheKey(entry.name, entry.version, 'objects'), encodeTier2Map(seedObjects)],
        [tier2CacheKey(entry.name, entry.version, 'headers'), encodeTier2Map(seedHeaders)],
      ]),
    );
    let fetches = 0;
    let compiles = 0;
    const deps: Tier2Deps = {
      fetch: async () => {
        fetches += 1;
        return new Uint8Array([0]);
      },
      cache: stub.cache,
      compileUnit: async () => {
        compiles += 1;
        return new Uint8Array([9]);
      },
    };
    const result = await buildTier2Objects('SevSeg', undefined, deps);
    expect(fetches).toBe(0);
    expect(compiles).toBe(0);
    expect([...result.objects.entries()]).toEqual([...seedObjects.entries()]);
    expect([...result.headers.entries()]).toEqual([...seedHeaders.entries()]);
  });

  it('builds every translation unit from a cached archive and caches outputs', async () => {
    const entry = TIER2_MANIFEST[0];
    const objectsKey = tier2CacheKey(entry.name, entry.version, 'objects');
    const headersKey = tier2CacheKey(entry.name, entry.version, 'headers');
    const stub = stubCache(
      new Map([[tier2CacheKey(entry.name, entry.version, 'archive'), sevSegZip()]]),
    );
    let fetches = 0;
    const seenSources: string[] = [];
    const deps: Tier2Deps = {
      fetch: async () => {
        fetches += 1;
        return new Uint8Array([0]);
      },
      cache: stub.cache,
      compileUnit: async (source) => {
        seenSources.push(source);
        return new TextEncoder().encode(`object:${source.length}`);
      },
    };
    const result = await buildTier2Objects('SevSeg', undefined, deps);
    expect(fetches).toBe(0);
    expect(seenSources).toEqual(['#include "SevSeg.h"\nint x = 1;\n']);
    expect([...result.objects.keys()]).toEqual(['SevSeg.o']);
    expect([...result.headers.keys()]).toEqual(['SevSeg.h']);
    expect(new TextDecoder().decode(result.headers.get('SevSeg.h'))).toBe('#pragma once\nint x;\n');
    expect(stub.puts).toEqual([objectsKey, headersKey]);
  });

  it('remaps Arduino 1.5 src/-rooted archives (RTClib)', async () => {
    const entry = TIER2_MANIFEST[1];
    const encoder = new TextEncoder();
    const zip = buildFixtureZip([
      { name: 'RTClib-2.1.4/src/RTClib.cpp', data: encoder.encode('#include "RTClib.h"\n'), method: 8 },
      { name: 'RTClib-2.1.4/src/RTClib.h', data: encoder.encode('#pragma once\n'), method: 0 },
      { name: 'RTClib-2.1.4/library.properties', data: encoder.encode('name=RTClib\n'), method: 0 },
    ]);
    const stub = stubCache(new Map([[tier2CacheKey(entry.name, entry.version, 'archive'), zip]]));
    let receivedHeaders: ReadonlyMap<string, string> | undefined;
    const deps: Tier2Deps = {
      fetch: async () => new Uint8Array([0]),
      cache: stub.cache,
      compileUnit: async (source, headers) => {
        receivedHeaders = headers;
        return encoder.encode(`object:${source}`);
      },
    };
    const result = await buildTier2Objects('RTClib', '2.1.4', deps);
    expect([...result.objects.keys()]).toEqual(['src/RTClib.o']);
    expect([...result.headers.keys()]).toEqual(['RTClib.h']);
    expect(receivedHeaders?.get('RTClib.h')).toBe('#pragma once\n');
  });

  it('caches nothing when a translation unit fails to compile', async () => {
    const entry = TIER2_MANIFEST[0];
    const stub = stubCache(
      new Map([[tier2CacheKey(entry.name, entry.version, 'archive'), sevSegZip()]]),
    );
    const deps: Tier2Deps = {
      fetch: async () => new Uint8Array([0]),
      cache: stub.cache,
      compileUnit: async () => {
        throw new Error('cc1plus failed: boom');
      },
    };
    await expect(buildTier2Objects('SevSeg', undefined, deps)).rejects.toThrow('cc1plus failed: boom');
    expect(stub.puts).toEqual([]);
  });
});
