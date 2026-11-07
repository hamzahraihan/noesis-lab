/**
 * C++ engine is the default (WASM_DEFAULT=true). The legacy TS engine
 * remains in ./engine-legacy.ts for rollback; gate with LEGACY_TS_ENGINE=1.
 *
 * To use the legacy TS engine, import from './engine-legacy' directly.
 * To use the C++ engine, import from './engine-wasm/adapter'.
 */
export * from './engine-legacy';
export * from './engine-wasm/adapter';