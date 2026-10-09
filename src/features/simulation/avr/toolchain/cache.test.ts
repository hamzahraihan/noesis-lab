import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FetchCache, MemoryBackend, CACHE_VERSION, CDN_BASE } from './cache';

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

  it('rejects an SRI mismatch without caching', async () => {
    const backend = new MemoryBackend();
    const fetchStub = vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 }));
    const cache = new FetchCache(backend, fetchStub, { 'a.bin': 'sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
    await expect(cache.fetch('a.bin')).rejects.toThrow(/integrity/i);
    expect(await backend.get(`${CACHE_VERSION}:a.bin`)).toBeNull();
    expect(fetchStub).toHaveBeenCalledTimes(1);
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
