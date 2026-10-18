import { describe, expect, it, vi } from 'vitest';
import { RP2040_LITTLEFS_WASM_URL, RP2040_UF2_URL, fetchRp2040Assets } from './assets';

describe('rp2040 assets', () => {
  it('addresses the pinned firmware and the littlefs wasm', () => {
    expect(RP2040_UF2_URL).toContain('RPI_PICO-20260824-v1.29.0.uf2');
    expect(RP2040_LITTLEFS_WASM_URL).toContain('littlefs');
    expect(RP2040_LITTLEFS_WASM_URL).toContain('.wasm');
  });

  it('fetches both assets through the injected fetcher', async () => {
    const uf2 = new ArrayBuffer(8);
    const littlefsWasm = new ArrayBuffer(16);
    const fetchBytes = vi.fn(async (url: string) => (url === RP2040_UF2_URL ? uf2 : littlefsWasm));
    const assets = await fetchRp2040Assets(fetchBytes);
    expect(fetchBytes).toHaveBeenCalledWith(RP2040_UF2_URL);
    expect(fetchBytes).toHaveBeenCalledWith(RP2040_LITTLEFS_WASM_URL);
    expect(assets.uf2).toBe(uf2);
    expect(assets.littlefsWasm).toBe(littlefsWasm);
  });

  it('propagates a fetch failure', async () => {
    const fetchBytes = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(fetchRp2040Assets(fetchBytes)).rejects.toThrow('offline');
  });

  it('memoizes the default fetch, and retries after a failure', async () => {
    const calls: string[] = [];
    let offline = true;
    const stub = vi.fn(async (url: string) => {
      calls.push(url);
      if (offline) throw new Error('offline');
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    });
    vi.stubGlobal('fetch', stub);
    try {
      // A failed fetch must not be cached: the retry below has to hit the wire.
      await expect(fetchRp2040Assets()).rejects.toThrow('offline');
      calls.length = 0;
      offline = false;

      const [first, second] = await Promise.all([fetchRp2040Assets(), fetchRp2040Assets()]);
      const third = await fetchRp2040Assets();
      // One request per artifact for the whole session, and the same bytes.
      expect(calls).toEqual([RP2040_UF2_URL, RP2040_LITTLEFS_WASM_URL]);
      expect(second).toBe(first);
      expect(third).toBe(first);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
