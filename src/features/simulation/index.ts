// Public seam for features/simulation. Populated in Task 3.
// Code outside this folder must import from '@/features/simulation', never deep.
export * from './engine';
export * from './circuit';
export * from './netlist';
export * from './mcu';
export * from './bench';
export * from './elements';
export * from './probe';
export * from './multimeter';
export * from './units';
export * from './matrix';
export * from './bus/i2c';
export * from './bus/spi';
export * from './bus/log';
export * from './firmware/interpreter';
export * from './firmware/parser';
export * from './firmware/python';
export * from './firmware/project';
export * from './avr/backend';
export * from './avr/core';
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
