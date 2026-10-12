/**
 * Thin re-export barrel: the tile store moved to `src/features/simulation/map/`
 * (sim-worker Task 7) so the worker core can own the map port without a
 * cross-feature edge. Bench imports of this path keep working unchanged.
 */
export {
  TILE_SIZE,
  TileStore,
  pixelInTile,
  tileForLatLon,
  tileId,
  type TileKey,
} from '@/features/simulation';
