import { describe, expect, it } from 'vitest';
import { OSM_ATTRIBUTION, OSM_TILE_URL, isRefusal, toRgb565 } from './map-fetcher';
import { TILE_SIZE, TileStore, pixelInTile, tileForLatLon, tileId } from './map-tiles';

/**
 * Relocated tile behavior (moved from `bench/utils` in sim-worker Task 7).
 *
 * Pure store math plus the decode helpers, all without a network: a test
 * needing the tile server would fail for reasons that have nothing to do
 * with the code. The worker core's map port is wired to this same store, so
 * these semantics are the worker path's semantics.
 */

function solidTile(red: number, green: number, blue: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = red;
    rgba[i + 1] = green;
    rgba[i + 2] = blue;
    rgba[i + 3] = 0xff;
  }
  return rgba;
}

describe('tile addresses', () => {
  it('names a tile the way the server URL does', () => {
    expect(tileId(16, 32742, 21792)).toBe('16/32742/21792');
  });

  it('puts London on the tile the reference gives', () => {
    expect(tileForLatLon(51.5067, -0.1427, 16)).toEqual({ x: 32742, y: 21792 });
  });

  it('doubles the world each time the zoom goes up', () => {
    expect(tileForLatLon(0, 0, 14)).toEqual({ x: 8192, y: 8192 });
    expect(tileForLatLon(0, 0, 16)).toEqual({ x: 32768, y: 32768 });
  });

  it('stops at the poles rather than asking for a tile that is not there', () => {
    for (const latitude of [90, -90, 1000]) {
      const tile = tileForLatLon(latitude, 0, 16);
      expect(tile.y, `latitude ${latitude}`).toBeGreaterThanOrEqual(0);
      expect(tile.y, `latitude ${latitude}`).toBeLessThan(2 ** 16);
    }
  });

  it('places a marker inside its tile rather than on an edge', () => {
    const pixel = pixelInTile(51.5067, -0.1427, 16);
    expect(pixel.x).toBeGreaterThanOrEqual(0);
    expect(pixel.x).toBeLessThan(TILE_SIZE);
    expect(pixel.y).toBeGreaterThanOrEqual(0);
    expect(pixel.y).toBeLessThan(TILE_SIZE);
  });
});

describe('the tile store', () => {
  it('hands over a tile it was given and reports the wait over', () => {
    const store = new TileStore();
    expect(store.request(16, 100, 200)).toBe(false);
    expect(store.complete).toBe(false);
    store.put(16, 100, 200, new Uint16Array(TILE_SIZE * TILE_SIZE).fill(0xf800));
    expect(store.get(16, 100, 200)).toHaveLength(TILE_SIZE * TILE_SIZE);
    expect(store.complete).toBe(true);
  });

  it('does not let one refused tile hold up the ones that arrived', () => {
    const store = new TileStore();
    store.request(16, 100, 200);
    store.request(16, 101, 200);
    store.put(16, 100, 200, new Uint16Array(TILE_SIZE * TILE_SIZE).fill(0x07e0));
    expect(store.fail(16, 101, 200)).toBe(true);
    expect(store.complete).toBe(true);
  });

  it('reports a failed tile as settled rather than re-queueing it', () => {
    const store = new TileStore();
    store.request(16, 5, 5);
    store.fail(16, 5, 5);
    expect(store.isFailed(16, 5, 5)).toBe(true);
    expect(store.request(16, 5, 5)).toBe(true);
    expect(store.get(16, 5, 5)).toBeUndefined();
  });

  it('forgets failures with the region, so panning back retries', () => {
    const store = new TileStore();
    store.request(16, 7, 7);
    store.fail(16, 7, 7);
    store.clearWanted();
    expect(store.isFailed(16, 7, 7)).toBe(false);
    expect(store.request(16, 7, 7)).toBe(false);
  });

  it('forgets a failure once the tile actually turns up', () => {
    const store = new TileStore();
    store.request(16, 9, 9);
    store.fail(16, 9, 9);
    store.put(16, 9, 9, new Uint16Array(4).fill(0x1234));
    expect(store.isFailed(16, 9, 9)).toBe(false);
    expect(store.get(16, 9, 9)).toHaveLength(4);
  });
});

describe('tile decoding from the new home', () => {
  it('packs red into RGB565 the way the panel stores it', () => {
    const red = new Uint8ClampedArray([0xff, 0, 0, 0xff]);
    expect(toRgb565(red, 1, 1)[0]).toBe(0xf800);
  });

  it('produces one RGB565 value per pixel', () => {
    expect(toRgb565(solidTile(250, 249, 245), TILE_SIZE, TILE_SIZE)).toHaveLength(
      TILE_SIZE * TILE_SIZE,
    );
  });

  it('rejects a flat grey refusal card but passes map-like variation', () => {
    expect(isRefusal(solidTile(128, 128, 128))).toBe(true);
    expect(isRefusal(solidTile(252, 252, 250))).toBe(false);
  });

  it('points at a tile server a browser can actually fetch from', () => {
    expect(OSM_TILE_URL).toContain('openstreetmap');
    expect(OSM_TILE_URL).toContain('{z}');
    expect(OSM_TILE_URL).toContain('{x}');
    expect(OSM_TILE_URL).toContain('{y}');
    expect(OSM_ATTRIBUTION.length).toBeGreaterThan(0);
  });
});
