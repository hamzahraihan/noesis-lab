import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { IDBBackend } from '../toolchain/cache';
import {
  INDEX_FALLBACK_URL,
  INDEX_URL,
  fetchIndex,
  latestRelease,
  refreshIndex,
  searchIndex,
  type FetchIndexDeps,
  type IndexLibrary,
} from './index';

const fixture: IndexLibrary[] = [
  { name: 'Servo', versions: [{ version: '1.2.2', url: 'u1', checksum: 'SHA-256:aa', size: 1 }, { version: 'beta-x', url: 'u0', checksum: 'SHA-256:bb', size: 1 }], author: 'A', sentence: 'motors', category: 'Device Control', architectures: ['*'], providesIncludes: ['Servo.h'] },
  { name: 'Nope', versions: [{ version: '0.0.1', url: 'u2', checksum: 'SHA-256:cc', size: 1 }], author: 'B', sentence: 'nothing', category: 'Other', architectures: ['avr'], providesIncludes: [] },
  { name: 'MyServo', versions: [{ version: '1.0.0', url: 'u3', checksum: 'SHA-256:dd', size: 1 }], author: 'C', sentence: 'servo helper', category: 'Device Control', architectures: ['*'], providesIncludes: [] },
];

describe('library index search', () => {
  it('ranks name-prefix above substring above includes above sentence and caps at 50', () => {
    const names = searchIndex(fixture, 'servo').map((lib) => lib.name);
    expect(names).toEqual(['Servo', 'MyServo']);
  });

  it('picks semver latest and never a non-semver tag', () => {
    expect(latestRelease(fixture[0]).version).toBe('1.2.2');
  });

  it('filters by category when asked', () => {
    expect(searchIndex(fixture, '', { category: 'Other' }).map((lib) => lib.name)).toEqual(['Nope']);
  });
});

const NOW = Date.parse('2026-10-10T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function gz(obj: unknown): Uint8Array<ArrayBuffer> {
  return Buffer.from(gzipSync(JSON.stringify(obj)));
}

function servoRow(version: string): Record<string, unknown> {
  return {
    name: 'Servo',
    version,
    author: 'Arduino',
    sentence: 'Control servo motors',
    category: 'Device Control',
    architectures: ['*'],
    providesIncludes: ['Servo.h'],
    url: `http://example/${version}.zip`,
    archiveFileName: `Servo-${version}.zip`,
    size: 10,
    checksum: 'SHA-256:aa',
  };
}

function createStore(initial?: Record<string, Uint8Array>) {
  const map = new Map<string, Uint8Array>(Object.entries(initial ?? {}));
  return {
    get: vi.fn(async (key: string): Promise<Uint8Array | null> => map.get(key) ?? null),
    put: vi.fn(async (key: string, value: Uint8Array): Promise<void> => {
      map.set(key, value);
    }),
    delete: vi.fn(async (key: string): Promise<void> => {
      map.delete(key);
    }),
  };
}

type StoreStub = ReturnType<typeof createStore>;

function testDeps(
  store: Pick<StoreStub, 'get' | 'put' | 'delete'> & IDBBackend,
  fetchStub: typeof fetch,
): FetchIndexDeps {
  return { store, fetchFn: fetchStub, now: () => NOW };
}

function checkedKey(iso: string): Record<string, Uint8Array> {
  return {
    'arduino-index/lastChecked': new TextEncoder().encode(iso),
    [`arduino-index/${iso}`]: gz({ libraries: [servoRow('1.0.0')] }),
  };
}

describe('library index cache', () => {
  it('fetches, gunzips, groups rows newest-first, and stores under date keys', async () => {
    const store = createStore();
    const fetchStub = vi.fn<typeof fetch>(
      async () => new Response(gz({ libraries: [servoRow('1.0.0'), servoRow('1.2.2')] }), { status: 200 }),
    );
    const libs = await fetchIndex(testDeps(store, fetchStub));
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0][0]).toBe(INDEX_URL);
    expect(libs).toHaveLength(1);
    expect(libs[0].name).toBe('Servo');
    expect(libs[0].versions.map((r) => r.version)).toEqual(['1.2.2', '1.0.0']);
    expect(libs[0].providesIncludes).toEqual(['Servo.h']);
    const iso = new Date(NOW).toISOString();
    expect(await store.get(`arduino-index/${iso}`)).not.toBeNull();
    const checked = await store.get('arduino-index/lastChecked');
    expect(new TextDecoder().decode(checked as Uint8Array)).toBe(iso);
  });

  it('serves a fresh cache with zero fetches', async () => {
    const iso = new Date(NOW).toISOString();
    const store = createStore(checkedKey(iso));
    const fetchStub = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([0]), { status: 200 }));
    const libs = await fetchIndex(testDeps(store, fetchStub));
    expect(libs.map((lib) => lib.name)).toEqual(['Servo']);
    expect(fetchStub).toHaveBeenCalledTimes(0);
  });

  it('deletes corrupt bytes and refetches exactly once', async () => {
    const iso = new Date(NOW).toISOString();
    const store = createStore({
      'arduino-index/lastChecked': new TextEncoder().encode(iso),
      [`arduino-index/${iso}`]: new Uint8Array([0, 1, 2, 3]),
    });
    const fetchStub = vi.fn<typeof fetch>(
      async () => new Response(gz({ libraries: [servoRow('1.2.2')] }), { status: 200 }),
    );
    const libs = await fetchIndex(testDeps(store, fetchStub));
    expect(libs.map((lib) => lib.name)).toEqual(['Servo']);
    expect(store.delete).toHaveBeenCalledWith(`arduino-index/${iso}`);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('refetches when the stamp is older than 7 days', async () => {
    const oldIso = new Date(NOW - 8 * DAY_MS).toISOString();
    const store = createStore(checkedKey(oldIso));
    const fetchStub = vi.fn<typeof fetch>(
      async () => new Response(gz({ libraries: [servoRow('1.2.2')] }), { status: 200 }),
    );
    const libs = await fetchIndex(testDeps(store, fetchStub));
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(latestRelease(libs[0]).version).toBe('1.2.2');
  });

  it('refreshIndex returns new rows without reading the fresh cache', async () => {
    const iso = new Date(NOW).toISOString();
    const store = createStore(checkedKey(iso));
    const fetchStub = vi.fn<typeof fetch>(
      async () => new Response(gz({ libraries: [servoRow('9.9.9')] }), { status: 200 }),
    );
    const libs = await refreshIndex(testDeps(store, fetchStub));
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(libs[0].versions.map((r) => r.version)).toEqual(['9.9.9']);
  });

  it('falls back to the https origin when the http origin fails', async () => {
    const store = createStore();
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
      .mockResolvedValueOnce(new Response(gz({ libraries: [servoRow('1.2.2')] }), { status: 200 }));
    const libs = await fetchIndex(testDeps(store, fetchStub));
    expect(libs.map((lib) => lib.name)).toEqual(['Servo']);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(fetchStub.mock.calls[0][0]).toBe(INDEX_URL);
    expect(fetchStub.mock.calls[1][0]).toBe(INDEX_FALLBACK_URL);
  });

  it('throws a named error when cache and refetch are both corrupt', async () => {
    const iso = new Date(NOW).toISOString();
    const store = createStore({
      'arduino-index/lastChecked': new TextEncoder().encode(iso),
      [`arduino-index/${iso}`]: new Uint8Array([7, 7, 7]),
    });
    const fetchStub = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([9, 9]), { status: 200 }));
    await expect(fetchIndex(testDeps(store, fetchStub))).rejects.toThrow(/library index unreadable/);
  });

  it('caps results at 50 rows', () => {
    const many: IndexLibrary[] = Array.from({ length: 60 }, (_, i) => ({
      name: `Lib${String(i).padStart(2, '0')}`,
      versions: [{ version: '1.0.0', url: 'u', checksum: 'SHA-256:x', size: 1 }],
      author: 'A',
      sentence: 'lib',
      category: 'Other',
      architectures: ['*'],
      providesIncludes: [],
    }));
    expect(searchIndex(many, 'lib')).toHaveLength(50);
  });
});
