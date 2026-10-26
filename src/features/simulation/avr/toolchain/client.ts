// In-worker compile client: supported-library gate, worker lifecycle
// (ids, progress, cancel, watchdog), project orchestration (firmware TU plus
// library TUs, Tier-2 fetch, header merging), and per-TU GCC error mapping.
//
// The client owns everything testable. The worker file holds the fetch shim
// plus the single-TU `buildFirmware` call and the multi-TU tools.ts driver.
import { CDN_BASE, FetchCache, SRI, createProductionBackend } from './cache';
import { parseIntelHex } from '../hex';
import type { PackedLine } from '../packager';
import { packageSketch } from '../packager';
import type { FirmwareProject } from '@/features/simulation/firmware/project';
import { collectCustomUnits } from '../libraries/custom';
import {
  CURATED_LIBRARIES,
  libraryDeclarations,
  validateLibraries,
  type LibrarySlot,
} from '../libraries/model';
import { tier2ByName } from '../libraries/provided';
import {
  buildTier2Objects,
  decodeTier2Map,
  tier2CacheKey,
  type Tier2BuildResult,
} from '../libraries/tier2';
import { fetchIndex } from '../libraries/index';
import { buildIndexObjects, selectIndexRelease } from '../libraries/index-build';
import {
  BuildFailedError,
  buildProject,
  compileToolchainUnit,
  type ProjectBuildResult,
  type ToolchainUnit,
} from './tools';
import { parseDebugInfo, type CompiledDebugInfo } from '../debug/lines';
import type { ProjectCompileRequest } from './worker';

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

export interface UnitLineMap {
  readonly unit: string;
  readonly lineMap: readonly PackedLine[];
}

/**
 * Maps GCC stderr back to originating files across translation units. The
 * first `error:` frame wins: a frame naming a known unit (`/build/<unit>`)
 * maps through that unit's lineMap (TU line n -> lineMap[n - 1]); anything
 * else degrades to `activeName:1` with capped raw text (first 8 lines) so no
 * diagnostic is ever lost.
 */
export function mapGccErrorForUnits(
  stderr: string,
  units: readonly UnitLineMap[],
  activeName = '',
): CompileError {
  const frame = /^(.+?):(\d+):(\d+)?:?\s*error:\s*(.*)$/gm;
  const match = frame.exec(stderr);
  if (match) {
    const file = match[1] ?? '';
    const tuLine = Number.parseInt(match[2] ?? '', 10);
    const detail = (match[4] ?? '').trim();
    const found = units.find((entry) => baseName(file) === baseName(entry.unit));
    const origin = found?.lineMap[tuLine - 1];
    if (found !== undefined && origin !== undefined) {
      return { message: detail, tab: origin.file, line: origin.line };
    }
    return { message: `${file}:${match[2]}: ${detail}`, tab: activeName, line: 1 };
  }
  return { message: stderr.split('\n').slice(0, 8).join('\n'), tab: activeName, line: 1 };
}

/**
 * Maps GCC stderr back to a sketch tab. The first `error:` frame wins:
 * frames naming the TU map through `lineMap` (TU line n -> lineMap[n - 1]);
 * anything else degrades to `activeName:1` with capped raw text (first 8
 * lines) so no diagnostic is ever lost.
 */
export function mapGccError(
  stderr: string,
  lineMap: readonly PackedLine[],
  activeName: string,
): CompileError {
  return mapGccErrorForUnits(stderr, [{ unit: TU_BASENAME, lineMap }], activeName);
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
    if (!Array.isArray(manifest.headerFiles))
      throw new Error('toolchain manifest has no headerFiles');
    const headers = manifest.headerFiles.filter(
      (entry): entry is string => typeof entry === 'string',
    );
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
  /** Source rows from the linked ELF's DWARF table, when it has one. */
  debug?: CompiledDebugInfo;
}

let nextCompileId = 1;
const COMPILE_WATCHDOG_MS = 120_000;

/**
 * Compiles the TU string in the worker and resolves with flash words parsed
 * from the returned Intel HEX. `lineMap` translates the TU's source rows back
 * to the sketch tabs the packager flattened; without it the mapped rows are
 * dropped and the build carries no source map. Rejects with CompileError
 * on build failure, Error('compile cancelled') on abort, and
 * Error('library <X> is not bundled (see <N> supported headers)') when the
 * gate fires before compiling.
 */
export async function compileInWorker(
  source: string,
  onProgress: (stage: string) => void,
  signal: AbortSignal,
  lineMap?: readonly PackedLine[],
): Promise<CompileResult> {
  if (signal.aborted) throw new Error('compile cancelled');
  onProgress('manifest');
  const supported = await loadSupportedHeaders();
  const missing = unsupportedIncludes(source, supported);
  if (missing.length > 0) {
    throw new Error(
      `library <${missing[0]}> is not bundled (see ${supported.size} supported headers)`,
    );
  }
  if (signal.aborted) throw new Error('compile cancelled');
  onProgress('compile');
  const unitMap =
    lineMap !== undefined && lineMap.length > 0 ? lineMap : identityUnitMap(source, '');
  const assembled: AssembledProject = {
    units: [{ name: TU_BASENAME, source, headers: new Map() }],
    prebuiltObjects: [],
    unitMaps: [{ unit: TU_BASENAME, lineMap: unitMap }],
    warnings: [],
  };
  let built: ProjectBuildResult;
  try {
    built =
      typeof Worker === 'undefined'
        ? await buildProjectInNode(assembled, signal)
        : await buildProjectInWorker(assembled, signal);
  } catch (error) {
    if (error instanceof BuildFailedError) {
      throw mapGccError(error.message, identityLineMap(source), '');
    }
    throw error;
  }
  onProgress('parse');
  return {
    hex: parseIntelHex(built.hexText),
    warnings: [],
    ...(built.debug === null ? {} : { debug: built.debug }),
  };
}

export interface ProjectLibraryContext {
  readonly slots: readonly LibrarySlot[];
  readonly tier2: (name: string, version: string | undefined) => Promise<Tier2BuildResult>;
  /** Installed index entries for validation; absent means no index library is known. */
  readonly indexInstalled?: ReadonlyMap<string, { headers: readonly string[] }>;
  /** Installed-index object builds; absent means index declarations cannot link. */
  readonly index?: (name: string, version: string | undefined) => Promise<Tier2BuildResult>;
}

export interface AssembledUnit {
  readonly name: string;
  readonly source: string;
  readonly headers: ReadonlyMap<string, string>;
}

export interface AssembledProject {
  /** units[0] is the firmware TU; the rest are library TUs in link order. */
  readonly units: AssembledUnit[];
  readonly prebuiltObjects: Uint8Array[];
  /** Parallel to units: per-TU error origins. */
  readonly unitMaps: UnitLineMap[];
  readonly warnings: string[];
}

function uniqueUnitName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  for (;;) {
    const candidate = base.replace(/(\.[^.]*)$/, `_${n}$1`);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    n += 1;
  }
}

/** Single-file TU: TU line n is file line n (trailing newline dropped, as in packageSketch). */
function identityUnitMap(source: string, file: string): PackedLine[] {
  const map: PackedLine[] = [];
  const parts = source.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  parts.forEach((_text, index) => {
    map.push({ file, line: index + 1 });
  });
  return map;
}

/**
 * Pure orchestration (no WASM): validates declarations, packs the firmware
 * TU, enumerates custom-slot TUs, fetches Tier-2 builds, and merges every
 * library header for the firmware TU. Tier-1 provided libraries ship in the
 * toolchain bundle, so they stage nothing. Throws Error on invalid
 * declarations or unbundled includes; header-only slots surface as warnings,
 * never errors.
 */
export async function assembleProjectUnits(
  project: FirmwareProject,
  ctx: ProjectLibraryContext,
  supported: ReadonlySet<string>,
): Promise<AssembledProject> {
  const invalid = validateLibraries(project, {
    slots: ctx.slots,
    indexInstalled: ctx.indexInstalled,
  });
  if (invalid.length > 0) throw new Error(invalid.join('; '));
  const packed = packageSketch(project);
  const firmwareHeaders = new Map<string, string>();
  const prebuiltObjects: Uint8Array[] = [];
  const warnings: string[] = [];
  const usedNames = new Set<string>([TU_BASENAME]);
  const units: AssembledUnit[] = [
    { name: TU_BASENAME, source: packed.source, headers: firmwareHeaders },
  ];
  const unitMaps: UnitLineMap[] = [{ unit: TU_BASENAME, lineMap: packed.lineMap }];
  const mergeHeaders = (headers: ReadonlyMap<string, string>): void => {
    for (const [name, content] of headers) {
      if (!firmwareHeaders.has(name)) firmwareHeaders.set(name, content);
    }
  };
  for (const entry of libraryDeclarations(project)) {
    if (entry.source === 'custom') {
      const slot = ctx.slots.find(
        (candidate) => candidate.id === entry.name.slice('custom:'.length),
      );
      if (slot === undefined) continue; // refused by the gate above; defensive
      const built = collectCustomUnits(slot);
      warnings.push(...built.diagnostics);
      for (const unit of built.units) {
        mergeHeaders(unit.headers);
        const name = uniqueUnitName(unit.name, usedNames);
        units.push({ name, source: unit.source, headers: unit.headers });
        unitMaps.push({ unit: name, lineMap: identityUnitMap(unit.source, unit.path) });
      }
      continue;
    }
    if (entry.source === 'index') {
      if (ctx.index === undefined) throw new Error(`<${entry.name}>: index build unavailable`);
      const built = await ctx.index(entry.name, entry.version);
      for (const bytes of built.objects.values()) prebuiltObjects.push(bytes);
      const decoder = new TextDecoder();
      for (const [headerName, headerBytes] of built.headers) {
        if (!firmwareHeaders.has(headerName))
          firmwareHeaders.set(headerName, decoder.decode(headerBytes));
      }
      continue;
    }
    if (
      !CURATED_LIBRARIES.some((lib) => lib.name === entry.name) &&
      tier2ByName(entry.name) !== null
    ) {
      const built = await ctx.tier2(entry.name, entry.version);
      for (const bytes of built.objects.values()) prebuiltObjects.push(bytes);
      const decoder = new TextDecoder();
      for (const [headerName, headerBytes] of built.headers) {
        if (!firmwareHeaders.has(headerName))
          firmwareHeaders.set(headerName, decoder.decode(headerBytes));
      }
    }
    // Tier-1 provided libraries ship in the toolchain bundle: nothing to stage.
  }
  const allowed = new Set<string>(supported);
  for (const name of firmwareHeaders.keys()) allowed.add(name);
  const missing = unsupportedIncludes(packed.source, allowed);
  if (missing.length > 0) {
    throw new Error(
      `library <${missing[0]}> is not bundled (see ${supported.size} supported headers)`,
    );
  }
  return { units, prebuiltObjects, unitMaps, warnings };
}

/**
 * Production context: slots from the UI plus Tier-2 builds through
 * buildTier2Objects (SHA-verified fetch, versioned cache, per-TU
 * cc1plus+as). Tier-2 compiles run on the calling thread and are cached
 * across sessions, so steady-state builds never compile them.
 */
export function createProjectLibraryContext(
  slots: readonly LibrarySlot[],
  opts?: { indexInstalled?: ReadonlyMap<string, { headers: readonly string[] }> },
): ProjectLibraryContext {
  return {
    slots,
    indexInstalled: opts?.indexInstalled,
    tier2: (name, version) => {
      const backend = createProductionBackend();
      // Captured before the toolchain shim installs: the Arduino-index zip
      // lives off-CDN (SHA-256-verified by buildTier2Objects itself), while
      // every toolchain byte the compile below fetches stays SRI-shimmed.
      const directFetch = globalThis.fetch.bind(globalThis);
      return withToolchainFetch(() =>
        buildTier2Objects(name, version, {
          fetch: async (url: string) => {
            const res = await directFetch(url);
            if (!res.ok) throw new Error(`library fetch failed for ${url}: ${res.status}`);
            return new Uint8Array(await res.arrayBuffer());
          },
          cache: {
            get: (key) => backend.get(key),
            put: (key, value) => backend.put(key, value),
          },
          compileUnit: (source, headers) =>
            compileToolchainUnit({ name: 'Tier2Unit.cpp', source, headers }),
        }),
      );
    },
    index: (name, version) => buildProductionIndex(name, version),
  };
}

/**
 * Production installed-index build: an exact pinned version with cached
 * objects serves with zero fetches and no index parse; otherwise the pinned
 * (or latest) release resolves through the live index and builds verified
 * through the same Tier-2 seam, SRI-shimmed. Requested versions absent from
 * the index fail naming them, never silently latest.
 */
async function buildProductionIndex(
  name: string,
  version: string | undefined,
): Promise<Tier2BuildResult> {
  const backend = createProductionBackend();
  if (version !== undefined) {
    const [hitObjects, hitHeaders] = await Promise.all([
      backend.get(tier2CacheKey(name, version, 'objects')),
      backend.get(tier2CacheKey(name, version, 'headers')),
    ]);
    if (hitObjects !== null && hitHeaders !== null) {
      const objects = decodeTier2Map(hitObjects);
      const headers = decodeTier2Map(hitHeaders);
      if (objects !== null && headers !== null) return { objects, headers };
    }
  }
  // Captured before the toolchain shim installs: the Arduino index and the
  // library zip live off-CDN (SHA-256-verified by buildIndexObjects itself),
  // while every toolchain byte the compile below fetches stays SRI-shimmed.
  const directFetch = globalThis.fetch.bind(globalThis);
  const libs = await fetchIndex({ store: backend, fetchFn: directFetch });
  const lib = libs.find((candidate) => candidate.name === name) ?? null;
  const release = lib === null ? null : selectIndexRelease(lib, version);
  if (release === null)
    throw new Error(`<${name}>: version ${version ?? 'latest'} is not in the index`);
  return withToolchainFetch(() =>
    buildIndexObjects(
      { name, release },
      {
        fetch: async (url: string) => {
          const res = await directFetch(url);
          if (!res.ok) throw new Error(`library fetch failed for ${url}: ${res.status}`);
          return new Uint8Array(await res.arrayBuffer());
        },
        cache: {
          get: (key) => backend.get(key),
          put: (key, value) => backend.put(key, value),
        },
        compileUnit: (source, headers) =>
          compileToolchainUnit({ name: 'IndexUnit.cpp', source, headers }),
      },
    ),
  );
}

/**
 * Compiles a library project: firmware TU plus library TUs linked with
 * prebuilt Tier-2 objects. Same CompileResult shape as compileInWorker, plus
 * header-only slot diagnostics as warnings. Rejects with CompileError on
 * toolchain failure (per-TU origins via unitMaps), Error on gate/cancel/
 * transport failures.
 */
export async function compileProjectWithLibraries(
  project: FirmwareProject,
  ctx: ProjectLibraryContext,
  onProgress: (stage: string) => void,
  signal: AbortSignal,
): Promise<CompileResult> {
  if (signal.aborted) throw new Error('compile cancelled');
  onProgress('manifest');
  const supported = await loadSupportedHeaders();
  onProgress('libraries');
  const assembled = await assembleProjectUnits(project, ctx, supported);
  if (signal.aborted) throw new Error('compile cancelled');
  onProgress('compile');
  let built: ProjectBuildResult;
  try {
    built =
      typeof Worker === 'undefined'
        ? await buildProjectInNode(assembled, signal)
        : await buildProjectInWorker(assembled, signal);
  } catch (error) {
    if (error instanceof BuildFailedError) {
      throw mapGccErrorForUnits(error.message, assembled.unitMaps, project.activeName);
    }
    throw error;
  }
  onProgress('parse');
  return {
    hex: parseIntelHex(built.hexText),
    warnings: assembled.warnings,
    ...(built.debug === null ? {} : { debug: built.debug }),
  };
}

/** TU line n -> line n with no tab: preserves the TU line for the caller. */
function identityLineMap(source: string): PackedLine[] {
  const map: PackedLine[] = [];
  const count = source.split('\n').length;
  for (let i = 0; i < count; i += 1) map.push({ file: '', line: i + 1 });
  return map;
}

function buildProjectInWorker(
  assembled: AssembledProject,
  signal: AbortSignal,
): Promise<ProjectBuildResult> {
  const units = assembled.units.map((unit) => {
    const headers: Record<string, string> = {};
    for (const [name, content] of unit.headers) headers[name] = content;
    return { name: unit.name, source: unit.source, headers };
  });
  const request: Omit<ProjectCompileRequest, 'id'> = {
    units,
    prebuiltObjects: assembled.prebuiltObjects,
    lineMaps: assembled.unitMaps,
  };
  return runWorkerRequest(request, signal);
}

/** Same worker lifecycle (ids, cancel, watchdog) for both payload shapes. */
function runWorkerRequest(
  request: Omit<ProjectCompileRequest, 'id'>,
  signal: AbortSignal,
): Promise<ProjectBuildResult> {
  return new Promise<ProjectBuildResult>((resolve, reject) => {
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
      const data = event.data as {
        id?: unknown;
        ok?: unknown;
        hexText?: unknown;
        errors?: unknown;
        debug?: unknown;
      };
      if (data === null || typeof data !== 'object' || data.id !== id || settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      if (data.ok === true && typeof data.hexText === 'string' && data.hexText.length > 0) {
        resolve({ hexText: data.hexText, debug: parseDebugInfo(data.debug) });
      } else if (data.ok === false) {
        reject(
          new BuildFailedError(typeof data.errors === 'string' ? data.errors : 'compile failed'),
        );
      } else {
        reject(new Error('toolchain returned no HEX'));
      }
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      fail(new Error(event.message === '' ? 'compile worker failed' : event.message));
    });
    worker.postMessage({ ...request, id });
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
    if (active >= maxConcurrent)
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
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

/** Multi-TU node fallback: same shim, shared tools.ts driver, abort between stages. */
async function buildProjectInNode(
  assembled: AssembledProject,
  signal: AbortSignal,
): Promise<ProjectBuildResult> {
  if (signal.aborted) throw new Error('compile cancelled');
  const units: ToolchainUnit[] = assembled.units.map((unit) => ({
    name: unit.name,
    source: unit.source,
    headers: unit.headers,
  }));
  const built = await withToolchainFetch(() =>
    buildProject(
      {
        units,
        prebuiltObjects: assembled.prebuiltObjects,
        lineMaps: assembled.unitMaps,
      },
      signal,
    ),
  );
  if (signal.aborted) throw new Error('compile cancelled');
  if (built.hexText.length === 0) throw new Error('toolchain returned no HEX');
  return built;
}

/** Installs the SRI-verified FetchCache fetch shim, runs, and restores. */
async function withToolchainFetch<T>(run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch.bind(globalThis);
  const cache = new FetchCache(createProductionBackend(), limitConcurrency(realFetch, 6), SRI);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = cachePathFor(href);
    // See worker.ts: the WASM content type is load-bearing under Node, where
    // Emscripten's readAsync/readBinary hooks are undefined and streaming
    // compile is the only instantiation path.
    return new Response((await cache.fetch(path)).slice().buffer, {
      status: 200,
      headers: { 'Content-Type': contentTypeFor(path) },
    });
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}
