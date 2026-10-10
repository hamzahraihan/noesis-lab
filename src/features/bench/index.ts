// Two-tier seam for features/bench (T7 dispatch §2).
//
// Tier 1 — this barrel — is node-safe: every module below loads in node with
// no DOM/monaco chain, so tests and features/learn import through here.
// Tier 2 — the DOM shell (Bench, Workbench) — lives behind explicit deep
// paths `@/features/bench/Bench`, imported ONLY by the composition layer
// (`src/app/**`, `src/routes/**`). Bench.tsx pulls instruments/Panels into
// monaco-editor, which crashes vitest node collection (Task 5 reviewer), so
// the shell must never transitively enter this barrel.
export { Simulation } from './simulations/simulation';
export {
  routeWire,
  routeWireCorners,
  routeWireVia,
  routeWireViaCorners,
  roundedPath,
  wireLanes,
} from './wiring/wire-route';
export type { Point, RouteSpan } from './wiring/wire-route';
export {
  artworkBox,
  pinFitError,
  pushWokwiState,
  renderedSizeMm,
  WOKWI_PARTS,
  wokwiPartFor,
} from './wokwi/wokwi';
export type { WokwiPart } from './wokwi/wokwi';
export { partTransform } from './wiring/part-transform';
export { PartFootprint } from './wokwi/footprints';
export type { FootprintState } from './wokwi/footprints';
export { HardwareDefs } from './wokwi/hardware';
export { PartPreview } from './components/PartPreview';
export { DEFAULT_WIRE_COLOUR, WIRE_COLOURS } from './wiring/wire-colours';
export type { WireColour } from './wiring/wire-colours';
