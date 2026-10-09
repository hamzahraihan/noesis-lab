// AVR toolchain worker entry. The client spawns this via
// `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`
// so the WASM GCC build runs off the main thread.
//
// Every toolchain byte flows through FetchCache (SRI-verified against the
// pinned table in cache.ts): the fetch shim below routes all requests by URL
// pathname relative to CDN_BASE, and the package's own `assetsBase` support
// points its tools/assets fetches at CDN_BASE.
import { CDN_BASE, FetchCache, MemoryBackend, SRI } from './cache';

const realFetch = globalThis.fetch.bind(globalThis);
const cache = new FetchCache(new MemoryBackend(), realFetch, SRI);

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
  return new Response(bytes.slice().buffer, { status: 200, headers: { 'Content-Type': contentTypeFor(path) } });
}) as typeof fetch;

export interface CompileRequest {
  readonly id: number;
  readonly source: string;
}

export interface CompileResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly hexText?: string;
  readonly errors?: string;
}

async function handle(source: string): Promise<string> {
  const toolchain = await import('@horang-corp/avr-gcc-wasm');
  toolchain.setAssetsBase(CDN_BASE);
  const result = await toolchain.buildFirmware({ source });
  if (typeof result.hex !== 'string' || result.hex.length === 0) {
    throw new Error('toolchain returned no HEX');
  }
  return result.hex;
}

self.addEventListener('message', (event: MessageEvent) => {
  const { id, source } = event.data as CompileRequest;
  handle(source).then(
    (hexText: string) => {
      self.postMessage({ id, ok: true, hexText } satisfies CompileResponse);
    },
    (error: unknown) => {
      const errors = error instanceof Error ? error.message : String(error);
      self.postMessage({ id, ok: false, errors } satisfies CompileResponse);
    },
  );
});
