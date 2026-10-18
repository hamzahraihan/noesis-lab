/**
 * Fetching tiles, which is the part a microcontroller would do and this host
 * does instead.
 *
 * The firmware has no network, so the browser plays the part of the radio: it
 * asks for a tile, decodes the PNG, and hands over finished pixels. The sketch
 * never learns which it was talking to -- it asks for a tile by its three
 * numbers and polls until one turns up, which is what a real program does while
 * an HTTP request is in flight.
 */

import type { TileKey } from './map-tiles';

/**
 * A tile server this host can actually fetch from a browser.
 *
 * OpenStreetMap's own volunteer-run servers are the obvious first choice and
 * the wrong one here. They block what they cannot identify: a browser cannot
 * set the `User-Agent` their usage policy asks for, because that header is
 * forbidden to page scripts, so the request arrives anonymous. What comes back
 * is not an error -- it is a 200 carrying a small grey PNG that says "403
 * Access blocked", which decodes perfectly and blits onto the panel as a
 * screenful of nothing. That is the failure this line exists to prevent: a map
 * that looks like a wiring mistake and is really a server saying no.
 *
 * `tile.openstreetmap.de` runs the same tile project and is used by plenty of
 * browser clients, and it sends `Access-Control-Allow-Origin: *`, so a tile
 * fetched here can be decoded rather than merely displayed. Attribution is not
 * optional either way, and is drawn on the panel by the sketch.
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** How many tiles to keep, so a learner panning around does not grow forever. */
const TILE_CACHE_LIMIT = 96;

/**
 * Fetches OSM tiles and keeps them.
 *
 * Decoding is the browser's: a PNG goes into `createImageBitmap`, through a
 * 2D context, and comes back as pixels. No image library, which matters because
 * this app has no dependencies to spare and the browser already does exactly
 * this.
 *
 * Every tile is cached twice over, here and in the tile store, because a
 * learner who pans left and back should not pay for the same tile twice and
 * should not watch it appear twice either.
 */
export class TileFetcher {
  private readonly cache = new Map<string, Promise<Uint16Array | null>>();

  private readonly inFlight = new Map<string, Promise<Uint16Array | null>>();

  /**
   * A tile's pixels, or null when it could not be fetched.
   *
   * Cached as a promise so two sketches asking for the same tile at once share
   * one request rather than making two, and so a tile that failed is remembered
   * as having failed rather than being retried every frame.
   */
  async fetch(tile: TileKey): Promise<Uint16Array | null> {
    const key = `${tile.z}/${tile.x}/${tile.y}`;

    const cached = this.cache.get(key);
    if (cached) return cached;

    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight;

    const request = this.load(tile)
      .catch(() => null)
      .then((result) => {
        this.inFlight.delete(key);
        if (result === null) return null;
        this.trim();
        return result;
      });

    this.inFlight.set(key, request);
    this.cache.set(key, request);
    return request;
  }

  /** True while anything is still on the wire. */
  get busy(): boolean {
    return this.inFlight.size > 0;
  }

  private trim(): void {
    // Insertion order is the order they arrived, so the oldest is the first
    // key -- which is the one to drop.
    while (this.cache.size > TILE_CACHE_LIMIT) {
      const oldest = this.cache.keys().next();
      if (oldest.done) return;
      this.cache.delete(oldest.value);
    }
  }

  private async load(tile: TileKey): Promise<Uint16Array | null> {
    const url = OSM_TILE_URL.replace('{z}', String(tile.z))
      .replace('{x}', String(tile.x))
      .replace('{y}', String(tile.y));

    const response = await fetch(url);
    if (!response.ok) return null;

    const bitmap = await createImageBitmap(await response.blob());

    /*
     * A tile with no pixels is not a tile. It happened for a real reason -- the
     * width was read after the bitmap was closed, so every decode came back
     * empty -- and it was invisible because an empty array is still an array.
     * Refusing it here means a broken decoder shows up as a missing tile the
     * sketch already knows how to retry, rather than as a screenful of nothing
     * that looks like a wiring fault.
     */
    if (bitmap.width === 0 || bitmap.height === 0) {
      bitmap.close();
      return null;
    }

    /*
     * The size has to be read before the bitmap is closed, and it is not a
     * detail: `close()` releases the decoded image and the browser zeroes the
     * width and height along with it. Read afterwards they come back 0, so the
     * buffer is allocated at zero length and every tile decodes to nothing --
     * an empty array that is truthy, so nothing complains and the panel simply
     * stays black. A tile server refusing to answer and a tile arriving
     * perfectly both looked exactly the same from the sketch.
     */
    const width = bitmap.width;
    const height = bitmap.height;

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return null;
    }

    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    bitmap.close();

    if (isRefusal(data)) {
      return null;
    }

    return toRgb565(data, width, height);
  }
}

/**
 * Whether these pixels are a server refusing rather than a piece of map.
 *
 * A blocked tile is served as a perfectly valid image, so nothing about the
 * response says no -- the only way to notice is to look at what came back.
 *
 * Two things have to be true, and the second is the one that matters: the tile
 * has to be nearly all one flat colour, and that colour has to be *mid* grey.
 * Flatness alone is not enough, because plenty of good tiles are flat: open
 * sea is one blue, empty desert one pale sand. Judged on flatness alone those
 * get thrown away and the map has holes exactly where the interesting nothing
 * is. A refusal card is grey, and grey in the middle of the range.
 */
export function isRefusal(rgba: Uint8ClampedArray): boolean {
  // A handful of samples is enough and keeps this off the hot path: the answer
  // does not change within a tile, and decoding already cost far more.
  const samples = 256;
  const step = Math.max(4, Math.floor((rgba.length / 4 / samples) * 4) * 4);
  let opaque = 0;
  let flat = 0;

  for (let i = 0; i < rgba.length; i += step) {
    if (rgba[i + 3] < 200) continue;
    opaque++;
    // Within a whisker of each other on all three channels is a flat colour.
    if (Math.abs(rgba[i] - rgba[i + 1]) <= 6 && Math.abs(rgba[i + 1] - rgba[i + 2]) <= 6) {
      flat++;
    }
  }

  if (opaque === 0 || flat / opaque <= 0.97) return false;

  // One more pass, to tell that grey from white, and from the blue of a sea.
  let red = 0;
  let green = 0;
  let blue = 0;
  let counted = 0;
  for (let i = 0; i < rgba.length; i += step) {
    if (rgba[i + 3] < 200) continue;
    red += rgba[i];
    green += rgba[i + 1];
    blue += rgba[i + 2];
    counted++;
  }
  if (counted === 0) return false;

  const mean = (red + green + blue) / (3 * counted);
  const spread = Math.max(red, green, blue) / counted - Math.min(red, green, blue) / counted;
  return mean > 70 && mean < 200 && spread < 24;
}

/**
 * RGBA bytes to RGB565, which is what the panel stores.
 *
 * Five bits of red, six of green, five of blue, and the high bit dropped off
 * each. The drop is not rounding: `>> 3` truncates, so colour 31 is the one you
 * asked for and colour 30 is 3% darker. Averaging the low bits instead would be
 * marginally more accurate and costs a third as many instructions again, which
 * on a board doing this for a whole screen matters.
 */
export function toRgb565(rgba: Uint8ClampedArray, width: number, height: number): Uint16Array {
  const out = new Uint16Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = ((rgba[p] >> 3) << 11) | ((rgba[p + 1] >> 2) << 5) | (rgba[p + 2] >> 3);
  }
  return out;
}
