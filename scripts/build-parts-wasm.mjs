// `npm run build:parts` — compiles the C++ part models to
// src/features/parts/wasm/parts.wasm and records native/parts-wasm-manifest.json.
//
// The differential tests read the separate probe manifest
// (npm run build:parts:probe); both entry points share scripts/lib/parts-build.mjs
// so they cannot drift apart.
import { isEntryPoint, partsBuildTarget, runPartsBuild } from './lib/parts-build.mjs';

export const target = partsBuildTarget('wasm');

if (isEntryPoint(import.meta.url)) await runPartsBuild(target);
