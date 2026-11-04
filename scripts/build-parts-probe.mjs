// `npm run build:parts:probe` — compiles the C++ part models to
// src/features/parts/wasm/parts.wasm and records native/parts-probe-manifest.json.
//
// The differential tests read this manifest; `npm run build:parts` writes the
// public one. Both entry points share scripts/lib/parts-build.mjs so the flags
// and the cache key cannot drift apart.
import { isEntryPoint, partsBuildTarget, runPartsBuild } from './lib/parts-build.mjs';

export const target = partsBuildTarget('probe');

if (isEntryPoint(import.meta.url)) await runPartsBuild(target);
