/**
 * Compiles the C++ simulation core into the Emscripten browser module.
 *
 * Artifacts (committed build outputs):
 *   - public/assets/engine.js   (ES module glue, MODULARIZE + EXPORT_ES6)
 *   - public/assets/engine.wasm
 *   - native/engine-ffi-manifest.json
 *
 * `public/` is Vite's static directory, so the artifacts are served in dev and
 * copied verbatim into `dist/assets/` by `npm run build`.
 *
 * A committed manifest records a sha256 over the engine sources, the FFI
 * schema and header, the compiler flags and the emcc version, plus the sha256
 * of both outputs. When everything agrees the script exits "up to date"
 * without compiling, so tests read the committed artifacts and never need
 * emcc.
 *
 * The entry point is `native/src/engine_main.cpp` when ticket #56 has landed
 * and `native/src/engine_ffi_stub.cpp` until then.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { ENGINE_EXPORTS } from './engine-exports.mjs';
import { emccChildEnv, resolveEmcc } from './parts-build.mjs';

const LIB_FILE = fileURLToPath(import.meta.url);
const JS_LIBRARY_FILE = join(dirname(LIB_FILE), 'engine-js-library.js');
const EXPORTS_FILE = join(dirname(LIB_FILE), 'engine-exports.mjs');

export const ROOT = join(dirname(LIB_FILE), '..', '..');

const ENGINE_FILES = Object.freeze([
  'engine.cpp',
  'solver.cpp',
  'netlist.cpp',
  'cpu.cpp',
  'firmware.cpp',
]);

const STALE_LOCK_MS = 5 * 60 * 1000;

/** Layout for the build. `root` is injectable so the cache tests need no repo. */
export function engineFfiTarget(root = ROOT) {
  const nativeDir = join(root, 'native');
  const engineDir = join(root, 'src', 'features', 'simulation', 'engine-wasm');
  const outputDir = join(root, 'public', 'assets');
  return {
    root,
    nativeDir,
    engineDir,
    outputDir,
    outputJs: join(outputDir, 'engine.js'),
    outputWasm: join(outputDir, 'engine.wasm'),
    manifest: join(nativeDir, 'engine-ffi-manifest.json'),
    schema: join(nativeDir, 'abi', 'engine-ffi.schema.json'),
    ffiHeader: join(nativeDir, 'include', 'ffi-generated.h'),
    jsLibrary: join(root, 'scripts', 'lib', 'engine-js-library.js'),
    mainEntry: join(nativeDir, 'src', 'engine_main.cpp'),
    stubEntry: join(nativeDir, 'src', 'engine_ffi_stub.cpp'),
  };
}

/** Engine translation units plus the FFI entry point (real one when present). */
export function engineFfiSources(target) {
  const entry = existsSync(target.mainEntry) ? target.mainEntry : target.stubEntry;
  return [...ENGINE_FILES.map((file) => join(target.engineDir, file)), entry];
}

/**
 * The entry points the schema declares, merged with the shared core surface.
 * Order is stable so the flag string, and therefore the cache key, is stable.
 */
export function exportedFunctions(target) {
  const schema = JSON.parse(readFileSync(target.schema, 'utf8'));
  const declared = schema?.ffi?.exports;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`${relative(target.root, target.schema)}: ffi.exports is missing or empty`);
  }
  const names = [...ENGINE_EXPORTS, ...declared.map((entry) => entry.name)];
  return [...new Set(names)];
}

/**
 * The exact emcc invocation. `MALLOC=none` is load-bearing: the C++ core hands
 * out its own heap with `wasm_alloc` starting at `__heap_base`, and linking
 * dlmalloc would make both allocators claim the same bytes.
 */
export function buildFlags(target) {
  return [
    '-O2',
    '-std=c++20',
    '-fno-exceptions',
    '-fno-rtti',
    '-s', 'WASM=1',
    '-s', 'MODULARIZE=1',
    '-s', 'EXPORT_ES6=1',
    '-s', 'EXPORT_NAME=EngineModule',
    '-s', `EXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions(target).map((name) => `_${name}`))}`,
    '-s', 'EXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPF64,HEAPU8,HEAP32',
    '-s', 'ALLOW_MEMORY_GROWTH=1',
    '-s', 'MALLOC=none',
    '-s', 'INITIAL_MEMORY=33554432',
    '-s', 'MAXIMUM_MEMORY=536870912',
    '-s', 'ENVIRONMENT=web',
    '-s', 'INVOKE_RUN=0',
    '--js-library', target.jsLibrary,
    '-I', target.engineDir,
    '-I', join(target.nativeDir, 'include'),
    '-Wl,--no-entry',
  ];
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function buildFilesFor(target, buildFiles) {
  // The flags live in these scripts, not in the C++ sources, so editing one
  // must invalidate the cache too.
  return buildFiles ?? [LIB_FILE, JS_LIBRARY_FILE, EXPORTS_FILE, target.jsLibrary];
}

export function createEngineFfiBuild(
  target = engineFfiTarget(ROOT),
  { emcc = resolveEmcc(target.root), buildFiles, lockDir = tmpdir() } = {},
) {
  const env = emccChildEnv(target.root);
  const flags = buildFlags(target);

  const toolVersion = () => {
    try {
      const out = execFileSync(emcc, ['--version'], { encoding: 'utf8', timeout: 10000, env });
      return out.trim().split('\n')[0];
    } catch {
      return 'unknown';
    }
  };

  const preflight = () => {
    try {
      execFileSync(emcc, ['--version'], { stdio: 'ignore', timeout: 10000, env });
    } catch {
      console.error(
        `Emscripten (emcc) not found: tried $EMCC, the in-repo emsdk/, and PATH. ` +
        `Install emsdk and run 'source emsdk_env.sh', or set EMSDK to the emsdk root.`,
      );
      process.exit(1);
    }
  };

  // Build inputs: every engine source/header, the FFI schema and generated
  // header, the scripts that carry the flags, and the toolchain version.
  const sourcesHash = () => {
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(cpp|h|hpp)$/.test(entry.name)) files.push(full);
      }
    };
    walk(target.engineDir);
    files.push(...engineFfiSources(target), target.ffiHeader, target.schema);
    const lines = [...new Set(files)]
      .sort()
      .map((file) => `${relative(target.root, file).split(sep).join('/')}\t${sha256(readFileSync(file))}`);
    for (const file of buildFilesFor(target, buildFiles)) {
      lines.push(`build\t${sha256(readFileSync(file))}`);
    }
    lines.push(`flags\t${flags.join(' ')}`);
    lines.push(`tool\temcc@${toolVersion()}`);
    return sha256(lines.join('\n'));
  };

  const readManifest = () => {
    try {
      return JSON.parse(readFileSync(target.manifest, 'utf8'));
    } catch {
      return null;
    }
  };

  // The manifest is only current when its key and both outputs agree.
  const currentManifest = () => {
    const manifest = readManifest();
    if (manifest === null) return null;
    if (manifest.sourcesHash !== sourcesHash()) return null;
    if (!existsSync(target.outputWasm) || sha256(readFileSync(target.outputWasm)) !== manifest.wasmSha256) {
      return null;
    }
    if (!existsSync(target.outputJs) || sha256(readFileSync(target.outputJs)) !== manifest.jsSha256) {
      return null;
    }
    return manifest;
  };

  const reportUpToDate = (manifest) => {
    console.log(
      `engine.wasm up to date (sourcesHash ${manifest.sourcesHash.slice(0, 12)}); skipping rebuild`,
    );
  };

  const lock = join(
    lockDir,
    `noesis-lab-engine-ffi-${createHash('sha256').update(target.root).digest('hex').slice(0, 12)}.lock`,
  );

  const acquireLock = async () => {
    for (;;) {
      try {
        mkdirSync(lock);
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) {
          rmSync(lock, { recursive: true, force: true });
        }
      } catch {
        // Lock vanished between the mkdir probe and the stat; retry directly.
      }
      await sleep(100);
    }
  };

  const buildOnce = () => {
    const tag = `${process.pid}-${Date.now()}`;
    // Compile into a temp directory that still ends in the final basename:
    // Emscripten bakes the output `.wasm` name into the glue, so compiling
    // straight to `.build-tmp-engine-<tag>.js` would leave engine.js fetching
    // a temp name that no longer exists after the rename.
    const tmpDir = join(target.outputDir, `.build-tmp-engine-${tag}`);
    const tmpJs = join(tmpDir, 'engine.js');
    const tmpWasm = join(tmpDir, 'engine.wasm');

    try {
      mkdirSync(tmpDir, { recursive: true });

      execFileSync(emcc, [...flags, '-o', tmpJs, ...engineFfiSources(target)], {
        cwd: target.root,
        stdio: 'inherit',
        timeout: 300000,
        env,
      });

      // `.gitattributes` commits the glue with LF, so a Windows build that
      // emitted CRLF would produce a manifest hash no clean checkout matches.
      // Normalise here and the committed artifact is byte-identical everywhere.
      writeFileSync(tmpJs, readFileSync(tmpJs, 'utf8').replace(/\r\n/g, '\n'));

      // Replace the committed artifacts only after the compile succeeded, by
      // rename: a reader never observes a half-written module.
      renameSync(tmpJs, target.outputJs);
      renameSync(tmpWasm, target.outputWasm);

      const manifest = {
        file: 'engine.wasm',
        wasmSha256: sha256(readFileSync(target.outputWasm)),
        jsSha256: sha256(readFileSync(target.outputJs)),
        sourcesHash: sourcesHash(),
        toolchain: { emcc: toolVersion() },
      };
      const tmpManifest = `${target.manifest}.tmp-${tag}`;
      writeFileSync(tmpManifest, `${JSON.stringify(manifest, null, 2)}\n`);
      renameSync(tmpManifest, target.manifest);

      console.log(
        `built engine.wasm (${statSync(target.outputWasm).size} bytes) + engine.js ` +
        `(${statSync(target.outputJs).size} bytes); sourcesHash ${manifest.sourcesHash}`,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  };

  const run = async () => {
    try {
      preflight();
      const manifest = currentManifest();
      if (manifest !== null) {
        reportUpToDate(manifest);
        return;
      }
      await acquireLock();
      try {
        const fresh = currentManifest();
        if (fresh !== null) reportUpToDate(fresh);
        else buildOnce();
      } finally {
        rmSync(lock, { recursive: true, force: true });
      }
    } catch (error) {
      console.error(
        `Engine FFI build failed: ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    }
  };

  return { target, flags, sourcesHash, currentManifest, buildOnce, run };
}

/** Entry point body: build the module, or exit non-zero saying why not. */
export async function runEngineFfiBuild() {
  await createEngineFfiBuild().run();
}
