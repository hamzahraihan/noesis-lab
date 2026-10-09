import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FetchCache, IndexedDBBackend, MemoryBackend, CACHE_VERSION, CDN_BASE } from './cache';

function sha384Pin(body: Uint8Array): string {
  return `sha384-${createHash('sha384').update(body).digest('base64')}`;
}

describe('fetch cache', () => {
  it('serves from the network once, then from cache', async () => {
    const body = new Uint8Array([1, 2, 3]);
    const fetchStub = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));
    const cache = new FetchCache(new MemoryBackend(), fetchStub, { 'a.bin': sha384Pin(body) });
    expect(await cache.fetch('a.bin')).toEqual(body);
    expect(await cache.fetch('a.bin')).toEqual(body);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0][0]).toBe(`${CDN_BASE}a.bin`);
  });

  it('rejects a persistently corrupt origin after exactly one retry', async () => {
    const backend = new MemoryBackend();
    const fetchStub = vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 }));
    const cache = new FetchCache(backend, fetchStub, { 'a.bin': 'sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
    await expect(cache.fetch('a.bin')).rejects.toThrow(/refetch failed/i);
    expect(await backend.get(`${CACHE_VERSION}:a.bin`)).toBeNull();
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('drops a corrupt entry and re-fetches exactly once', async () => {
    const backend = new MemoryBackend();
    await backend.put(`${CACHE_VERSION}:a.bin`, new Uint8Array([0]));
    const fetchStub = vi.fn(async () => new Response(new Uint8Array([7]), { status: 200 }));
    const cache = new FetchCache(backend, fetchStub, {});
    // Corruption is detected by the consumer; the cache exposes invalidate(path) for that path:
    await cache.invalidate('a.bin');
    expect(await cache.fetch('a.bin')).toEqual(new Uint8Array([7]));
    expect(fetchStub).toHaveBeenCalledTimes(1);
    // The fresh entry is cached; no re-fetch loop exists.
    expect(await cache.fetch('a.bin')).toEqual(new Uint8Array([7]));
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

interface FakeIDBRequest<T> {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  result: T;
  error: Error | null;
}

// Minimal fake of exactly the IDB surface IndexedDBBackend exercises:
// factory.open(name, version) with onupgradeneeded/onsuccess, db with
// objectStoreNames.contains + createObjectStore + transaction, and store
// get/put/delete requests with onsuccess/onerror. No new dependencies.
function createFakeIDB(): IDBFactory {
  const databases = new Map<string, { version: number; stores: Map<string, Map<string, Uint8Array>> }>();
  function complete<T>(value: T): FakeIDBRequest<T> {
    const request: FakeIDBRequest<T> = {
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      result: value,
      error: null,
    };
    queueMicrotask(() => {
      request.onsuccess?.();
    });
    return request;
  }
  const factory = {
    open(dbName: string, version?: number) {
      const requested = version ?? 1;
      let record = databases.get(dbName);
      const isUpgrade = record === undefined || requested > record.version;
      if (record === undefined) {
        record = { version: requested, stores: new Map() };
        databases.set(dbName, record);
      } else if (requested > record.version) {
        record.version = requested;
      }
      const db = record;
      const request: FakeIDBRequest<unknown> = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: {
          objectStoreNames: { contains: (name: string) => db.stores.has(name) },
          createObjectStore: (name: string) => {
            if (!db.stores.has(name)) db.stores.set(name, new Map());
            return {};
          },
          transaction: (storeName: string) => ({
            objectStore: () => {
              const store = db.stores.get(storeName);
              if (store === undefined) throw new Error(`no such store: ${storeName}`);
              return {
                get: (key: string) => complete(store.has(key) ? store.get(key) : undefined),
                put: (value: Uint8Array, key: string) => {
                  store.set(key, value);
                  return complete(undefined);
                },
                delete: (key: string) => {
                  store.delete(key);
                  return complete(undefined);
                },
              };
            },
          }),
        },
        error: null,
      };
      queueMicrotask(() => {
        if (isUpgrade) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return factory as unknown as IDBFactory;
}

describe('indexeddb backend', () => {
  it('round-trips put to get', async () => {
    const backend = new IndexedDBBackend({ idb: createFakeIDB() });
    const body = new Uint8Array([1, 2, 3]);
    expect(await backend.get(`${CACHE_VERSION}:a.bin`)).toBeNull();
    await backend.put(`${CACHE_VERSION}:a.bin`, body);
    expect(await backend.get(`${CACHE_VERSION}:a.bin`)).toEqual(body);
  });

  it('keeps different cache versions isolated', async () => {
    const backend = new IndexedDBBackend({ idb: createFakeIDB() });
    await backend.put(`${CACHE_VERSION}:a.bin`, new Uint8Array([1, 2, 3]));
    expect(await backend.get(`${CACHE_VERSION}:a.bin`)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await backend.get(`other-version:a.bin`)).toBeNull();
  });

  it('deletes entries', async () => {
    const backend = new IndexedDBBackend({ idb: createFakeIDB() });
    await backend.put(`${CACHE_VERSION}:a.bin`, new Uint8Array([5]));
    await backend.delete(`${CACHE_VERSION}:a.bin`);
    expect(await backend.get(`${CACHE_VERSION}:a.bin`)).toBeNull();
  });

  it('shares committed entries across instances on the same database', async () => {
    const idb = createFakeIDB();
    const body = new Uint8Array([8, 9]);
    await new IndexedDBBackend({ idb }).put(`${CACHE_VERSION}:a.bin`, body);
    expect(await new IndexedDBBackend({ idb }).get(`${CACHE_VERSION}:a.bin`)).toEqual(body);
  });
});

describe('corrupt-cache auto-recovery', () => {
  it('heals a poisoned entry with a single refetch, then serves from cache', async () => {
    const backend = new MemoryBackend();
    const good = new Uint8Array([7, 7, 7]);
    await backend.put(`${CACHE_VERSION}:a.bin`, new Uint8Array([0]));
    const fetchStub = vi.fn(async () => new Response(good, { status: 200 }));
    const cache = new FetchCache(backend, fetchStub, { 'a.bin': sha384Pin(good) });
    expect(await cache.fetch('a.bin')).toEqual(good);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(await cache.fetch('a.bin')).toEqual(good);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('degrades cleanly when the refetch is poisoned too, fetching exactly twice', async () => {
    const backend = new MemoryBackend();
    await backend.put(`${CACHE_VERSION}:a.bin`, new Uint8Array([0]));
    const fetchStub = vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 }));
    const cache = new FetchCache(backend, fetchStub, { 'a.bin': sha384Pin(new Uint8Array([1, 2, 3])) });
    await expect(cache.fetch('a.bin')).rejects.toThrow(/refetch failed/i);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(await backend.get(`${CACHE_VERSION}:a.bin`)).toBeNull();
  });
});
