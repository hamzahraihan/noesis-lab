// Multi-TU toolchain driver: cc1plus -> avr-as per unit, avr-ld link of all
// unit objects plus prebuilt (Tier-2) objects plus the manifest core objects,
// then avr-objcopy to Intel HEX text.
//
// Every helper mirrors node_modules/@horang-corp/avr-gcc-wasm/firmware-builder.js
// (package 0.2.0): flag lists come from TIER2_CC1_FLAGS/TIER2_AS_FLAGS in
// ../libraries/tier2 (same -D defines, same -isystem/-I roots, same codegen),
// the FS helpers and runTool error shapes match the package, and the linker
// argv matches its linkerArgs (avr5 emulation, -Tdata SRAM origin fix,
// --gc-sections, crtatmega328p.o first, -L/libs -lm -lc -lgcc).
//
// Shared by worker.ts (browser module worker) and the client node fallback
// (vitest). Both hosts shim global fetch through FetchCache/SRI before calling
// in, so every byte here (tool .mjs text, .wasm, manifest, headers, objects,
// libs, ldscripts) is integrity-checked. Tool modules are self-contained
// Emscripten MODULARIZE factories with no relative imports: the worker loads
// them via blob-URL import, Node via data:-URL import (Node's ESM loader
// rejects blob: URLs; data: URLs import the same 135 KB glue fine).
import { CDN_BASE } from './cache';
import { TIER2_AS_FLAGS, TIER2_CC1_FLAGS } from '../libraries/tier2';
import { parseElfDebugLines } from '../debug/dwarf';
import { buildDebugLines, type CompiledDebugInfo, type DebugUnitMap } from '../debug/lines';

export interface ToolchainUnit {
  /** Basename-style object name, e.g. 'HorangFirmware.cpp' — built at /build/<name>. */
  readonly name: string;
  readonly source: string;
  /** Extra headers (basename -> content) visible to this TU via -I /build/include. */
  readonly headers: ReadonlyMap<string, string>;
}

export interface ProjectBuildRequest {
  /** units[0] is the firmware TU; the rest are library TUs. */
  readonly units: readonly ToolchainUnit[];
  /** Already-compiled Tier-2 objects, linked after the unit objects. */
  readonly prebuiltObjects: readonly Uint8Array[];
  /** Manifest object paths; defaults to core_abi.o plus the base group. */
  readonly manifestObjects?: readonly string[];
  /** Per-unit TU-line -> sketch-line maps, for the DWARF line table. */
  readonly lineMaps?: readonly DebugUnitMap[];
}

/** HEX plus the source rows the linked ELF's DWARF line table describes. */
export interface ProjectBuildResult {
  readonly hexText: string;
  readonly debug: CompiledDebugInfo | null;
}

/** Thrown for toolchain failures (compile/assemble/link/objcopy). The message
 * carries the tool's stderr tail, so GCC `error:` frames survive for mapping.
 * Transport, cache, and cancellation failures stay plain Errors. */
export class BuildFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildFailedError';
  }
}

/** TIER2_CC1_FLAGS with the <tu.cpp>/<tu>/<tu.s> slots filled for one unit,
 * plus -I /build/include so the unit's extra headers resolve. */
export function cc1plusArgsFor(cppPath: string, dumpBase: string, asmPath: string): string[] {
  const args = TIER2_CC1_FLAGS.map((flag) =>
    flag === '<tu.cpp>' ? cppPath : flag === '<tu>' ? dumpBase : flag === '<tu.s>' ? asmPath : flag,
  );
  args.push('-I', '/build/include');
  return args;
}

/** Constant half of the package's avr-as argv, completed with -o/out/in. */
export function avrAsArgsFor(asmPath: string, objectPath: string): string[] {
  return [...TIER2_AS_FLAGS, '-o', objectPath, asmPath];
}

/** The package's linkerArgs with caller-supplied objects: crt first, then
 * firmware, library, and prebuilt objects (slot objects precede provided
 * ones, so slots shadow on duplicate symbols — GNU ld first-wins), then the
 * manifest core objects, then the system libs. */
export function linkerArgsFor(
  extraObjects: readonly string[],
  manifestObjects: readonly string[],
): string[] {
  return [
    '-m',
    'avr5',
    '-Tdata=0x800100',
    '--gc-sections',
    '-o',
    '/build/HorangFirmware.elf',
    '/libs/crtatmega328p.o',
    ...extraObjects,
    ...manifestObjects,
    '-L/libs',
    '-lm',
    '-lc',
    '-lgcc',
  ];
}

function isNode(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.node === 'string';
}

interface ToolFS {
  mkdir(path: string): void;
  stat(path: string): unknown;
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string): Uint8Array;
}

type EmscriptenFactory = (options: Record<string, unknown>) => Promise<{
  FS: ToolFS;
  callMain: (args: readonly string[]) => void;
}>;

const TOOL_NAMES = ['cc1plus', 'avr-as', 'avr-ld', 'avr-objcopy'] as const;
type ToolName = (typeof TOOL_NAMES)[number];

const WASM_FILE_BY_TOOL: Record<ToolName, string> = {
  cc1plus: 'cc1plus.wasm',
  'avr-as': 'avr-as.wasm',
  'avr-ld': 'avr-ld.wasm',
  'avr-objcopy': 'avr-objcopy.wasm',
};

const factoryCache = new Map<ToolName, Promise<EmscriptenFactory>>();

function toolModuleUrl(text: string): string {
  // Blob import in workers/browsers; data: import under Node.
  if (!isNode()) return URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  if (typeof Buffer !== 'undefined')
    return `data:text/javascript;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
  return `data:text/javascript,${encodeURIComponent(text)}`;
}

/** Fetches the tool glue through the host's FetchCache shim and imports it. */
export function loadToolFactory(tool: ToolName): Promise<EmscriptenFactory> {
  let hit = factoryCache.get(tool);
  if (hit === undefined) {
    hit = (async () => {
      const res = await fetch(new URL(`tools/${tool}.mjs`, CDN_BASE));
      if (!res.ok) throw new Error(`Failed to fetch tools/${tool}.mjs: ${res.status}`);
      // Hoist the await: the production bundler wraps dynamic imports in a
      // non-async arrow (__vitePreload), so an await nested in the import()
      // argument is a SyntaxError in the built chunk.
      const text = await res.text();
      const mod = (await import(/* @vite-ignore */ toolModuleUrl(text))) as {
        default?: unknown;
      };
      const factory = mod.default ?? mod;
      if (typeof factory !== 'function') throw new Error(`${tool}: module has no factory export`);
      return factory as EmscriptenFactory;
    })();
    factoryCache.set(tool, hit);
  }
  return hit;
}

function ensureDir(fs: ToolFS, dir: string): void {
  if (!dir || dir === '/') return;
  const parts = dir.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    try {
      fs.mkdir(current);
    } catch (error) {
      if ((error as { errno?: unknown })?.errno !== 20) {
        try {
          fs.stat(current);
        } catch {
          throw error;
        }
      }
    }
  }
}

function writeFile(fs: ToolFS, path: string, data: string | Uint8Array): void {
  ensureDir(fs, path.split('/').slice(0, -1).join('/'));
  fs.writeFile(path, data);
}

function readBytes(fs: ToolFS, path: string): Uint8Array {
  const out = fs.readFile(path);
  return out instanceof Uint8Array ? out.slice() : new Uint8Array(out);
}

function describeError(error: unknown): string {
  if (!error) return 'unknown error';
  if (error instanceof Error) return error.message;
  return String(error);
}

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

interface ToolchainManifest {
  readonly headerFiles: readonly string[];
  readonly objectGroups: {
    readonly base: readonly string[];
    readonly oled: readonly string[];
    readonly tof: readonly string[];
  };
  readonly libs: readonly string[];
}

let manifestPromise: Promise<ToolchainManifest> | undefined;

/** Manifest through the host fetch shim (SRI-verified, cached per session). */
export function loadToolchainManifest(): Promise<ToolchainManifest> {
  manifestPromise ??= (async () => {
    const res = await fetch(new URL('assets/manifest.json', CDN_BASE));
    if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status}`);
    return (await res.json()) as ToolchainManifest;
  })();
  return manifestPromise;
}

async function writeManifestHeaders(fs: ToolFS): Promise<void> {
  const manifest = await loadToolchainManifest();
  await Promise.all(
    manifest.headerFiles.map(async (virtualPath) => {
      writeFile(fs, virtualPath, await fetchBytes(new URL(`assets/fs${virtualPath}`, CDN_BASE)));
    }),
  );
}

/** The package's runTool minus timings: fresh module per invocation, stderr
 * capture with [tool] prefixes, package-identical failure shapes. */
async function runTool(
  tool: ToolName,
  args: readonly string[],
  setup: ((fs: ToolFS) => void | Promise<void>) | undefined,
  outputPath: string,
): Promise<Uint8Array> {
  const stderr: string[] = [];
  const mod = await loadToolFactory(tool).then((factory) =>
    factory({
      noInitialRun: true,
      locateFile(path: string) {
        const wasmFile = path.endsWith('.wasm') ? WASM_FILE_BY_TOOL[tool] : path;
        return new URL(`tools/${wasmFile}`, CDN_BASE).href;
      },
      print() {},
      printErr(line: string) {
        if (line) stderr.push(`[${tool}] ${line}`);
      },
    }),
  );
  try {
    if (setup) await setup(mod.FS);
  } catch (error) {
    throw new BuildFailedError(`${tool} setup failed: ${describeError(error)}`);
  }
  try {
    mod.callMain(args);
  } catch (error) {
    const message = String((error as { message?: unknown })?.message ?? error);
    if (
      (error as { status?: unknown })?.status !== 0 &&
      !/Program terminated with exit\(0\)/.test(message)
    ) {
      throw new BuildFailedError(`${tool} failed: ${message}\n${stderr.slice(-20).join('\n')}`);
    }
  }
  try {
    return readBytes(mod.FS, outputPath);
  } catch (error) {
    throw new BuildFailedError(
      `${tool} did not produce ${outputPath}: ${describeError(error)}\n${stderr.slice(-20).join('\n')}`,
    );
  }
}

function objectPathFor(name: string): { cpp: string; asm: string; object: string } {
  const cpp = `/build/${name}`;
  const stem = cpp.replace(/\.[^.]*$/, '');
  return { cpp, asm: `${stem}.s`, object: `${stem}.o` };
}

/** cc1plus -> avr-as for one unit, mirroring the package's two stages. */
export async function compileToolchainUnit(unit: ToolchainUnit): Promise<Uint8Array> {
  const paths = objectPathFor(unit.name);
  const assembly = await runTool(
    'cc1plus',
    cc1plusArgsFor(paths.cpp, unit.name, paths.asm),
    async (fs) => {
      await writeManifestHeaders(fs);
      for (const [headerName, content] of unit.headers)
        writeFile(fs, `/build/include/${headerName}`, content);
      writeFile(fs, paths.cpp, unit.source);
    },
    paths.asm,
  );
  return runTool(
    'avr-as',
    avrAsArgsFor(paths.asm, paths.object),
    (fs) => {
      writeFile(fs, paths.asm, assembly);
    },
    paths.object,
  );
}

/**
 * Compiles every unit, links unit objects plus prebuilt objects plus the
 * manifest core objects, and returns the Intel HEX text with the linked ELF's
 * DWARF rows translated back to sketch tabs. Throws BuildFailedError (with GCC
 * frames) on toolchain failure, plain Error on transport failure or abort.
 */
export async function buildProject(
  request: ProjectBuildRequest,
  signal?: AbortSignal,
): Promise<ProjectBuildResult> {
  const check = (): void => {
    if (signal?.aborted) throw new Error('compile cancelled');
  };
  check();
  const unitObjects: Uint8Array[] = [];
  for (const unit of request.units) {
    check();
    unitObjects.push(await compileToolchainUnit(unit));
  }
  check();
  const manifest = await loadToolchainManifest();
  const manifestObjects = request.manifestObjects ?? [
    '/objects/core_abi.o',
    ...manifest.objectGroups.base,
  ];
  const extraPaths = [
    ...request.units.map((unit) => objectPathFor(unit.name).object),
    ...request.prebuiltObjects.map((_, index) => `/build/prebuilt-${index}.o`),
  ];
  const elf = await runTool(
    'avr-ld',
    linkerArgsFor(extraPaths, manifestObjects),
    async (fs) => {
      request.units.forEach((unit, index) => {
        writeFile(fs, objectPathFor(unit.name).object, unitObjects[index] as Uint8Array);
      });
      request.prebuiltObjects.forEach((bytes, index) => {
        writeFile(fs, `/build/prebuilt-${index}.o`, bytes);
      });
      writeFile(
        fs,
        '/ldscripts/avr5.xn',
        await fetchBytes(new URL('assets/ldscripts/avr5.xn', CDN_BASE)),
      );
      await Promise.all(
        manifestObjects.map(async (virtualPath) => {
          writeFile(fs, virtualPath, await fetchBytes(new URL(`assets${virtualPath}`, CDN_BASE)));
        }),
      );
      await Promise.all(
        manifest.libs.map(async (virtualPath) => {
          writeFile(fs, virtualPath, await fetchBytes(new URL(`assets${virtualPath}`, CDN_BASE)));
        }),
      );
    },
    '/build/HorangFirmware.elf',
  );
  check();
  // Debug info is an aid, never a build gate: a malformed line table returns
  // an empty list, and the HEX below still flashes exactly as before.
  const rows = buildDebugLines(parseElfDebugLines(elf), request.lineMaps ?? []);
  const debug = rows.length > 0 ? { lines: rows } : null;
  const hexBytes = await runTool(
    'avr-objcopy',
    ['-O', 'ihex', '-R', '.eeprom', '/build/HorangFirmware.elf', '/build/HorangFirmware.hex'],
    (fs) => {
      writeFile(fs, '/build/HorangFirmware.elf', elf);
    },
    '/build/HorangFirmware.hex',
  );
  check();
  return { hexText: new TextDecoder().decode(hexBytes), debug };
}
