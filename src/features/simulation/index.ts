// Public seam for features/simulation. Populated in Task 3.
// Code outside this folder must import from '@/features/simulation', never deep.
export * from './engine';
export * from './circuit';
export * from './circuit-doc';
export * from './circuit-edit';
export * from './netlist';
export * from './mcu';
export * from './bench';
export * from './elements';
export * from './probe';
export * from './plot';
export * from './vcd';
export * from './multimeter';
export * from './units';
export * from './matrix';
export * from './bus/i2c';
export * from './bus/spi';
export * from './bus/log';
export * from './firmware/interpreter';
export * from './firmware/parser';
export * from './firmware/debugger';
export * from './firmware/python';
export * from './firmware/project';
export * from './firmware/python-modules';
export * from './avr/backend';
export * from './avr/core';
export type { CompiledDebugInfo } from './avr/debug/lines';
export * from './avr/hex';
export * from './avr/packager';
export * from './avr/toolchain/client';
export * from './avr/libraries/model';
export * from './avr/libraries/provided';
export * from './avr/libraries/resolve';
// Task 4 consumes the index search/version/install names from instruments
// (bare `@/features/simulation` — the boundary gate forbids deep imports
// outside the owning feature). Cache/tools stay narrow named re-exports so
// the FetchCache/SRI internals do not join the public surface.
export * from './avr/libraries/index';
export * from './avr/libraries/index-build';
export { createProductionBackend } from './avr/toolchain/cache';
export { compileToolchainUnit } from './avr/toolchain/tools';
// Task 4 bench client consumes the SHM snapshot protocol via this barrel
// (bare `@/features/simulation` — the boundary gate forbids bench-deep
// imports outside the owning feature). Pure layout math only, no Engine.
export * from './sim-worker/protocol';
// Task 8 factory: bench reaches the worker only through this barrel export
// (same-feature relative URL inside `simulation/`; a cross-feature relative
// URL from bench would trip the boundary gate).
export { createSimWorker } from './sim-worker/entry-factory';
// Task 7 relocated the tile store + fetcher here so the worker core owns the
// map port without a cross-feature edge (bench reads them back through this
// barrel via thin re-export shims at the old `bench/utils/map-*` paths).
export * from './map/map-tiles';
export * from './map/map-fetcher';
// The bench's network, exported for the same reason the map is: both backends
// (in-page `Simulation` and the sim worker) wire the same port, and the worker
// core must reach it without a cross-feature edge.
export * from './net/network';
// The bridge to real hosts: the table the bench names them by, and the one
// fetcher every bridge goes through. The bench installs it (build data decides),
// the notice names the hosts, and nothing else may reach `fetch`.
export * from './net/live-hosts';
export * from './net/bridge';
/*
 * The scripting half of custom parts: the runtime is loaded lazily (`load.ts`),
 * so exporting the loader costs the bundle nothing and the 492 KB of QuickJS is
 * fetched only when a scripted part exists.
 */
export * from './scripted/load';
export * from './scripted/sampler';
export { clearReportedFaults, reportedFaults, type ScriptFault } from './scripted/diagnostics';
export * from './scripted/i2c';
export type {
  ScriptedReading,
  ScriptedRuntime,
  ScriptedPart,
  ScriptedBus,
} from './scripted/runtime';
// The bench's colour panel, exported for the same reason: both backends drive
// one port, and the gate that makes it obey the wires lives in the port.
export * from './display/tft';
// Issue #20 phase 1: the C++ solver's wasm seam. It stays off the default
// solve path until the final cutover; exported here so later phases and tests
// reach it through the public seam instead of a deep import.
export * from './engine-wasm/solver';
// Rollout seam (Stages 2-3): bench threads the wasm default through this
// barrel (bare `@/features/simulation` — the boundary gate forbids bench-deep
// imports). Named re-export only, so the harness-only helpers in wasm-core
// stay off the public surface. Stage 3 flips WASM_DEFAULT once the gates pass.
export { WASM_DEFAULT, resolveWasmFlag } from './avr/wasm-core';
