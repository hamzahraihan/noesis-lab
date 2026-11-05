// `npm run build:engine:ffi` — compiles the C++ simulation core with Emscripten
// into public/assets/engine.{js,wasm} and records native/engine-ffi-manifest.json.
//
// Vite copies public/ into dist/, so `npm run build` leaves the module at
// dist/assets/engine.{js,wasm}. The cache/manifest logic lives in
// scripts/lib/engine-ffi-build.mjs.
import { isEntryPoint } from './lib/parts-build.mjs';
import { runEngineFfiBuild } from './lib/engine-ffi-build.mjs';

if (isEntryPoint(import.meta.url)) await runEngineFfiBuild();
