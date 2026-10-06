/**
 * Map tiles: the pictures a map is actually made of.
 *
 * A slippy map is a grid. At zoom `z` the world is cut into `2^z` rows and
 * columns of square tiles, and a tile is addressed by its column and row -- so
 * "the map" is really a window onto four numbers: a zoom, and an x and a y that
 * name one tile. Everything else is deciding which tile you want.
 *
 * The tiles live here rather than in the firmware because the firmware has no
 * network. A program asks for a tile, finds out whether it has arrived, and
 * draws it when it has -- which is exactly the shape of a real program that
 * fetches over HTTP and does not get an answer straight away. What plays the
 * part of the network is the host: the browser fetches, decodes and hands over
 * finished pixels, and a sketch never knows the difference between a tile that
 * arrived in four milliseconds and one that took four hundred.
 */

/** A tile's address on the grid. */
export interface TileKey {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/** A tile side in pixels. The OSM standard, and every client since. */
export const TILE_SIZE = 256;

/** `"z/x/y"`, the form the tile server's URL uses and the form a cache wants. */
export function tileId(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

/**
 * Tiles that have arrived, and the ones firmware has asked for but is still
 * waiting on.
 *
 * The distinction matters: a program that draws "whatever is ready" flickers
 * through half a map, and one that insists on everything before drawing
 * anything stalls on the slowest tile forever. It needs to be able to ask which
 * is which, so it can either wait once at the start or draw the holes and
 * refill them as they land.
 */
export class TileStore {
  private readonly tiles = new Map<string, Uint16Array>();

  private readonly wanted = new Map<string, TileKey>();

  /**
   * Tiles that were asked for and will never arrive.
   *
   * Kept apart from `wanted` on purpose. A tile the server refuses to serve is
   * not a tile that is still on its way, and leaving it in `wanted` meant a
   * sketch polling for "have they all arrived?" waited forever for a picture
   * that was never coming -- which is a deadlock, not a wait, and it presented
   * as a blank screen with the serial monitor cheerfully reporting progress.
   * Recording the failure lets the wait finish and the rest of the map draw.
   */
  private readonly failed = new Map<string, TileKey>();

  /** Tiles a program has asked for that are not here yet. */
  get pending(): readonly TileKey[] {
    return [...this.wanted.values()];
  }

  /**
   * Records that firmware wants a tile, and whether it can have it now.
   *
   * A tile already given up on reports as ready rather than as wanted, so a
   * sketch polling for arrival is not sent back out to wait for something the
   * network has already declined. The hole stays a hole; the point is that one
   * missing tile cannot hold up the fourteen around it.
   */
  request(z: number, x: number, y: number): boolean {
    const id = tileId(z, x, y);
    if (this.tiles.has(id)) return true;
    if (this.failed.has(id)) return true;
    this.wanted.set(id, { z, x, y });
    return false;
  }

  /** True when every tile requested so far has arrived. */
  get complete(): boolean {
    return this.wanted.size === 0;
  }

  /** Hands over a tile's pixels, RGB565, one entry per pixel. */
  put(z: number, x: number, y: number, rgb565: Uint16Array): void {
    this.tiles.set(tileId(z, x, y), rgb565);
    this.wanted.delete(tileId(z, x, y));
    this.failed.delete(tileId(z, x, y));
  }

  /**
   * Records that a tile will never arrive, so the wait can finish.
   *
   * Returns whether it had been asked for at all, which is how a caller can
   * tell a tile that was requested from one nobody asked for -- worth knowing,
   * because the second means the request itself was wrong.
   */
  fail(z: number, x: number, y: number): boolean {
    const id = tileId(z, x, y);
    this.failed.set(id, { z, x, y });
    return this.wanted.delete(id);
  }

  /** True when this tile has already been given up on. */
  isFailed(z: number, x: number, y: number): boolean {
    return this.failed.has(tileId(z, x, y));
  }

  get(z: number, x: number, y: number): Uint16Array | undefined {
    return this.tiles.get(tileId(z, x, y));
  }

  /**
   * Drops every request, so a new region starts from nothing wanted.
   *
   * The failures go with them. They were recorded against a region, and keeping
   * them would mean panning away and back to a tile the server had already
   * declined never asks again -- the hole would be permanent rather than a
   * gap that closes once the network is behaving.
   */
  clearWanted(): void {
    this.wanted.clear();
    this.failed.clear();
  }

  clear(): void {
    this.tiles.clear();
    this.wanted.clear();
    this.failed.clear();
  }
}

/**
 * Turns a latitude, a longitude and a zoom into a tile address.
 *
 * This is the Mercator projection, and it is the whole reason a slippy map is
 * square. Latitude is not: the world is a sphere, and cutting a sphere into
 * squares needs a projection that stretches the poles to fill them. Mercator
 * does that, which is why Greenland looks the size of Africa and why nothing
 * near either pole is ever any use for a map.
 *
 * The sin is the projection. The two `&`s keep the arithmetic inside the
 * world, because a latitude of exactly 90 degrees is the one value where the
 * projection is infinite.
 */
export function tileForLatLon(
  latitude: number,
  longitude: number,
  zoom: number,
): { readonly x: number; readonly y: number } {
  const scale = 2 ** zoom;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sinLat = Math.sin((clamped * Math.PI) / 180);

  const x = Math.floor(((longitude + 180) / 360) * scale);
  const y = Math.floor((0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale);

  const limit = scale - 1;
  return {
    x: Math.max(0, Math.min(limit, x)),
    y: Math.max(0, Math.min(limit, y)),
  };
}

/**
 * Where a latitude and longitude lands inside a tile, in pixels.
 *
 * The fractional part of the tile number, times the tile side. This is the same
 * arithmetic as above, kept rather than thrown away, which is what lets a marker
 * sit between the tiles instead of on one of them.
 */
export function pixelInTile(
  latitude: number,
  longitude: number,
  zoom: number,
): { readonly x: number; readonly y: number } {
  const scale = 2 ** zoom * TILE_SIZE;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sinLat = Math.sin((clamped * Math.PI) / 180);

  const x = ((longitude + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;

  return { x: x % TILE_SIZE, y: y % TILE_SIZE };
}
