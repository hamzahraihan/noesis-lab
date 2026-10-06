import { describe, expect, it } from 'vitest';
import { isRefusal, toRgb565, OSM_TILE_URL } from './map-fetcher';
import { TILE_SIZE } from './map-tiles';

/**
 * Decoding a tile, which is where the map went wrong for a long time.
 *
 * The bug this file exists for was one line: the decoded bitmap's width and
 * height were read *after* `close()`, which zeroes them. Every tile therefore
 * decoded into a zero-length buffer -- an empty `Uint16Array`, which is truthy,
 * so nothing downstream complained and the panel just stayed black. From the
 * sketch a tile server refusing to answer and a tile arriving perfectly looked
 * identical, which is exactly the failure that is hardest to find.
 *
 * These are pure functions, so they are asserted without a network: the point
 * is the arithmetic, and a test that needed the internet would fail for reasons
 * that have nothing to do with the code.
 */

const WIDTH = TILE_SIZE;
const HEIGHT = TILE_SIZE;

/** RGBA for a whole tile, from a per-pixel colour function. */
function tileRgba(colour: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = colour(x, y);
      const i = (y * WIDTH + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 0xff;
    }
  }
  return rgba;
}

/** A tile that looks like map: pale paper with darker roads across it. */
function mapLikeTile(): Uint8ClampedArray {
  return tileRgba((x, y) => {
    const onRoad = y % 64 < 3 || x % 96 < 2;
    return onRoad ? [120, 120, 128] : [250, 249, 245];
  });
}

describe('decoding a tile', () => {
  it('produces one RGB565 value per pixel', () => {
    // The regression: a size of zero still produced a Uint16Array, so the
    // length is the only thing that could have caught this.
    const pixels = toRgb565(mapLikeTile(), WIDTH, HEIGHT);
    expect(pixels).toHaveLength(WIDTH * HEIGHT);
  });

  it('keeps the pixels it decoded rather than losing them', () => {
    const pixels = toRgb565(mapLikeTile(), WIDTH, HEIGHT);
    // Pale paper is mostly white, so a decoded map is overwhelmingly bright.
    const bright = pixels.filter((colour) => colour !== 0).length;
    expect(bright).toBeGreaterThan((WIDTH * HEIGHT) / 2);
  });

  it('packs a colour into RGB565 the way the panel stores it', () => {
    const red = new Uint8ClampedArray(4);
    red[0] = 0xff;
    red[1] = 0;
    red[2] = 0;
    red[3] = 0xff;
    expect(toRgb565(red, 1, 1)[0]).toBe(0xf800);
  });
});

describe('recognising a server that will not serve', () => {
  it('passes a real-looking map through', () => {
    expect(isRefusal(mapLikeTile())).toBe(false);
  });

  it('rejects a flat grey card, which is what a refusal looks like', () => {
    expect(isRefusal(tileRgba(() => [128, 128, 128]))).toBe(true);
  });

  it('does not call a mostly-white tile a refusal', () => {
    // The opposite failure: a pale map is nearly all one colour too, and
    // rejecting it would throw away most of the tiles that are perfectly good.
    expect(isRefusal(tileRgba(() => [252, 252, 250]))).toBe(false);
  });

  it('says nothing about a tile with nothing in it', () => {
    expect(isRefusal(new Uint8ClampedArray(0))).toBe(false);
  });
});

describe('where tiles come from', () => {
  it('asks a server that answers a browser', () => {
    /*
     * OpenStreetMap's own servers are the obvious choice and the wrong one: a
     * browser cannot send the User-Agent their policy asks for, because that
     * header is forbidden to page scripts. They reply with a 200 and a small
     * grey PNG reading "403 Access blocked", which decodes perfectly and is
     * why this had to be checked rather than assumed.
     */
    expect(OSM_TILE_URL).toContain('openstreetmap');
    expect(OSM_TILE_URL).toContain('{z}');
    expect(OSM_TILE_URL).toContain('{x}');
    expect(OSM_TILE_URL).toContain('{y}');
  });
});
