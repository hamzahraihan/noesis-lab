// AVR toolchain worker entry. The client spawns this via
// `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`
// so the WASM GCC build runs off the main thread.
//
// Every toolchain byte flows through FetchCache (SRI-verified against the
// pinned table in cache.ts): the fetch shim below routes all requests by URL
// pathname relative to CDN_BASE, and the package's own `assetsBase` support
// points its tools/assets fetches at CDN_BASE.
import { CDN_BASE, FetchCache, SRI, createProductionBackend } from './cache';
import { buildProject } from './tools';
import type { CompiledDebugInfo, DebugUnitMap } from '../debug/lines';

const realFetch = globalThis.fetch.bind(globalThis);
const cache = new FetchCache(createProductionBackend(), realFetch, SRI);

function cachePathFor(requestURL: string): string {
  const basePath = new URL(CDN_BASE).pathname;
  const path = new URL(requestURL, CDN_BASE).pathname;
  if (path.startsWith(basePath)) return path.slice(basePath.length);
  return path.replace(/^\/+/, '');
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.wasm')) return 'application/wasm';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.mjs') || path.endsWith('.js')) return 'text/javascript';
  return 'application/octet-stream';
}

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = cachePathFor(href);
  const bytes = await cache.fetch(path);
  // The WASM content type matters: Emscripten's instantiateStreaming path
  // rejects typeless responses, and under Node its readAsync/readBinary
  // hooks are undefined, so streaming compile is the only load path.
  return new Response(bytes.slice().buffer, {
    status: 200,
    headers: { 'Content-Type': contentTypeFor(path) },
  });
}) as typeof fetch;

export interface ProjectUnitPayload {
  readonly name: string;
  readonly source: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Extended payload, same protocol: the client owns orchestration (Tier-2
 * fetch, custom-slot enumeration, header merging) and posts firmware plus
 * library translation units with their headers, prebuilt Tier-2 objects,
 * optional manifest object paths, and the per-unit line maps that turn DWARF
 * rows back into sketch tabs. The worker compiles every unit (cc1plus+as),
 * links all objects, and returns HEX plus the mapped debug rows — or per-unit
 * GCC errors naming /build/<unit> frames for client-side mapping.
 */
export interface ProjectCompileRequest {
  readonly id: number;
  readonly units: readonly ProjectUnitPayload[];
  readonly prebuiltObjects?: readonly Uint8Array[];
  readonly manifestObjects?: readonly string[];
  readonly lineMaps?: readonly DebugUnitMap[];
}

export interface CompileResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly hexText?: string;
  readonly debug?: CompiledDebugInfo;
  readonly errors?: string;
}

async function handleProject(
  request: ProjectCompileRequest,
): Promise<{ hexText: string; debug: CompiledDebugInfo | null }> {
  const built = await buildProject({
    units: request.units.map((unit) => ({
      name: unit.name,
      source: unit.source,
      headers: new Map(Object.entries(unit.headers ?? {})),
    })),
    prebuiltObjects: request.prebuiltObjects ?? [],
    manifestObjects: request.manifestObjects,
    lineMaps: request.lineMaps,
  });
  if (built.hexText.length === 0) throw new Error('toolchain returned no HEX');
  return built;
}

self.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as ProjectCompileRequest;
  handleProject(data).then(
    (built) => {
      self.postMessage({
        id: data.id,
        ok: true,
        hexText: built.hexText,
        ...(built.debug === null ? {} : { debug: built.debug }),
      } satisfies CompileResponse);
    },
    (error: unknown) => {
      const errors = error instanceof Error ? error.message : String(error);
      self.postMessage({ id: data.id, ok: false, errors } satisfies CompileResponse);
    },
  );
});
