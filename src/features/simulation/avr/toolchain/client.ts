// In-worker compile client: supported-library gate, worker lifecycle
// (ids, progress, cancel, watchdog), and GCC error mapping.
//
// The client owns everything testable. The worker file holds only the fetch
// shim plus the dynamic toolchain import and `buildFirmware` call.
import { CDN_BASE, FetchCache, SRI, createProductionBackend } from './cache';
import { parseIntelHex } from '../hex';
import type { PackedLine } from '../packager';

/**
 * A compile failure located as precisely as the available context allows.
 *
 * A plain data shape (not an Error subclass) so it compares structurally.
 * `tab` is the originating sketch tab and `line` its 1-based line. When the
 * client maps without project context (it only sees the TU), `tab` is ''
 * and `line` is the TU line number, so the caller can translate through its
 * own lineMap.
 */
export interface CompileError {
  message: string;
  tab: string;
  line: number;
}

const TU_BASENAME = 'HorangFirmware.cpp';

/**
 * Maps GCC stderr back to a sketch tab. The first `error:` frame wins:
 * frames naming the TU map through `lineMap` (TU line n -> lineMap[n - 1]);
 * anything else degrades to `activeName:1` with capped raw text (first 8
 * lines) so no diagnostic is ever lost.
 */
export function mapGccError(stderr: string, lineMap: readonly PackedLine[], activeName: string): CompileError {
  const frame = /^(.+?):(\d+):(\d+)?:?\s*error:\s*(.*)$/gm;
  const match = frame.exec(stderr);
  if (match) {
    const file = match[1] ?? '';
    const tuLine = Number.parseInt(match[2] ?? '', 10);
    const detail = (match[4] ?? '').trim();
    const origin = lineMap[tuLine - 1];
    if ((file === TU_BASENAME || file.endsWith(`/${TU_BASENAME}`)) && origin !== undefined) {
      return { message: detail, tab: origin.file, line: origin.line };
    }
    return { message: `${file}:${match[2]}: ${detail}`, tab: activeName, line: 1 };
  }
  return { message: stderr.split('\n').slice(0, 8).join('\n'), tab: activeName, line: 1 };
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

/** Supported set: basenames of the manifest's listed headers, plus Arduino.h. */
export function supportedHeadersFrom(manifest: { headerFiles: string[] }): Set<string> {
  const supported = new Set<string>();
  for (const entry of manifest.headerFiles) supported.add(baseName(entry));
  supported.add('Arduino.h');
  return supported;
}

let supportedPromise: Promise<Set<string>> | undefined;

/** Loads the package manifest through the same FetchCache/CDN path as the build. */
export function loadSupportedHeaders(): Promise<Set<string>> {
  supportedPromise ??= (async () => {
    const cache = new FetchCache(createProductionBackend(), globalThis.fetch.bind(globalThis), SRI);
    const bytes = await cache.fetch('assets/manifest.json');
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as { headerFiles?: unknown };
    if (!Array.isArray(manifest.headerFiles)) throw new Error('toolchain manifest has no headerFiles');
    const headers = manifest.headerFiles.filter((entry): entry is string => typeof entry === 'string');
    return supportedHeadersFrom({ headerFiles: headers });
  })();
  return supportedPromise;
}

const ANGLE_INCLUDE = /#include\s*<([^>\s]+)>/g;

/** `#include <X>` names from the TU that fall outside the supported set. */
export function unsupportedIncludes(source: string, supported: ReadonlySet<string>): string[] {
  const missing: string[] = [];
  for (const match of source.matchAll(ANGLE_INCLUDE)) {
    const name = match[1];
    if (name !== undefined && !supported.has(name) && !missing.includes(name)) missing.push(name);
  }
  return missing;
}

export interface CompileResult {
  hex: Uint16Array;
  warnings: string[];
}

let nextCompileId = 1;
const COMPILE_WATCHDOG_MS = 120_000;

/**
 * Compiles the TU string in the worker and resolves with flash words parsed
 * from the returned Intel HEX. Rejects with CompileError on build failure,
 * Error('compile cancelled') on abort, and Error('library <X> is not
 * bundled (see <N> supported headers)') when the gate fires before compiling.
 */
export async function compileInWorker(
  source: string,
  onProgress: (stage: string) => void,
  signal: AbortSignal,
): Promise<CompileResult> {
  if (signal.aborted) throw new Error('compile cancelled');
  onProgress('manifest');
  const supported = await loadSupportedHeaders();
  const missing = unsupportedIncludes(source, supported);
  if (missing.length > 0) {
    throw new Error(`library <${missing[0]}> is not bundled (see ${supported.size} supported headers)`);
  }
  if (signal.aborted) throw new Error('compile cancelled');
  onProgress('compile');
  const hexText = typeof Worker === 'undefined' ? await buildInNode(source, signal) : await buildInWorker(source, signal);
  onProgress('parse');
  return { hex: parseIntelHex(hexText), warnings: [] };
}

/** TU line n -> line n with no tab: preserves the TU line for the caller. */
function identityLineMap(source: string): PackedLine[] {
  const map: PackedLine[] = [];
  const count = source.split('\n').length;
  for (let i = 0; i < count; i += 1) map.push({ file: '', line: i + 1 });
  return map;
}

function buildInWorker(source: string, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const id = nextCompileId++;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const timer = setTimeout(() => fail(new Error('compile timed out')), COMPILE_WATCHDOG_MS);
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      reject(error);
    };
    const onAbort = (): void => {
      fail(new Error('compile cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { id?: unknown; ok?: unknown; hexText?: unknown; errors?: unknown };
      if (data === null || typeof data !== 'object' || data.id !== id || settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      if (data.ok === true && typeof data.hexText === 'string' && data.hexText.length > 0) {
        resolve(data.hexText);
      } else if (data.ok === false) {
        reject(mapGccError(typeof data.errors === 'string' ? data.errors : 'compile failed', identityLineMap(source), ''));
      } else {
        reject(new Error('toolchain returned no HEX'));
      }
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      fail(new Error(event.message === '' ? 'compile worker failed' : event.message));
    });
    worker.postMessage({ id, source });
  });
}

function cachePathFor(requestURL: string): string {
  const basePath = new URL(CDN_BASE).pathname;
  const path = new URL(requestURL, CDN_BASE).pathname;
  if (path.startsWith(basePath)) return path.slice(basePath.length);
  return path.replace(/^\/+/, '');
}

/**
 * Caps concurrent upstream fetches. The toolchain fans out to ~500 parallel
 * asset requests; some networks/proxies drop the burst, so the node path
 * serializes upstream traffic while the SRI cache still absorbs repeats.
 */
function limitConcurrency(realFetch: typeof fetch, maxConcurrent: number): typeof fetch {
  let active = 0;
  const waiting: Array<() => void> = [];
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (active >= maxConcurrent) await new Promise<void>((resolve) => { waiting.push(resolve); });
    active += 1;
    try {
      return await realFetch(input, init);
    } finally {
      active -= 1;
      const next = waiting.shift();
      if (next !== undefined) next();
    }
  }) as typeof fetch;
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.wasm')) return 'application/wasm';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.mjs') || path.endsWith('.js')) return 'text/javascript';
  return 'application/octet-stream';
}

/**
 * Node fallback for the vitest environment, where the Vite web-worker entry
 * cannot be instantiated. Same package, same assetsBase, same TU, same
 * FetchCache/SRI path as the worker — just in-thread instead of in-worker.
 * Never runs in the browser.
 */
async function buildInNode(source: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new Error('compile cancelled');
  const realFetch = globalThis.fetch.bind(globalThis);
  const cache = new FetchCache(createProductionBackend(), limitConcurrency(realFetch, 6), SRI);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = cachePathFor(href);
    // See worker.ts: the WASM content type is load-bearing under Node, where
    // Emscripten's readAsync/readBinary hooks are undefined and streaming
    // compile is the only instantiation path.
    return new Response((await cache.fetch(path)).slice().buffer, { status: 200, headers: { 'Content-Type': contentTypeFor(path) } });
  }) as typeof fetch;
  try {
    const toolchain = await import(/* @vite-ignore */ '@horang-corp/avr-gcc-wasm');
    toolchain.setAssetsBase(CDN_BASE);
    const result = await toolchain.buildFirmware({ source });
    if (signal.aborted) throw new Error('compile cancelled');
    if (typeof result.hex !== 'string' || result.hex.length === 0) throw new Error('toolchain returned no HEX');
    return result.hex;
  } finally {
    globalThis.fetch = previousFetch;
  }
}
