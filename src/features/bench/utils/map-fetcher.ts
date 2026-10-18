/**
 * Thin re-export barrel: the tile fetcher moved to `src/features/simulation/map/`
 * (sim-worker Task 7) so the worker core can own the map port without a
 * cross-feature edge. Bench imports of this path keep working unchanged.
 */
export {
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  TileFetcher,
  isRefusal,
  toRgb565,
} from '@/features/simulation';
