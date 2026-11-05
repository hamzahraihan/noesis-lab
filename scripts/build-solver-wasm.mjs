/**
 * Compiles the C++ circuit solver to WebAssembly via Emscripten.
 *
 * Artifacts (committed build outputs):
 *   - dist/assets/solver.wasm
 *   - dist/assets/solver.js (glue code)
 *
 * A committed build-manifest.json records a sha256 over every build input
 * and the sha256 of both outputs. When the manifest, the inputs, and the
 * outputs all agree this script exits "up to date" without compiling.
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

import { emccChildEnv, resolveEmcc } from './lib/parts-build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_DIR = join(ROOT, 'native');
const DIST_DIR = join(ROOT, 'dist', 'assets');
const WASM_FILE = join(DIST_DIR, 'solver.wasm');
const JS_FILE = join(DIST_DIR, 'solver.js');
const MANIFEST_FILE = join(NATIVE_DIR, 'build-manifest.json');
// Resolve emcc the same way the parts and engine builds do: $EMCC, then the
// in-repo emsdk/, then PATH. `npm run build` must work without a sourced shell.
const EMCC = resolveEmcc(ROOT);
const CHILD_ENV = emccChildEnv(ROOT);

// Rebuilds take seconds; a lock this old means the holder died mid-build.
const LOCK = join(
  tmpdir(),
  `noesis-lab-solver-wasm-${createHash('sha256').update(ROOT).digest('hex').slice(0, 12)}.lock`,
);
const STALE_LOCK_MS = 5 * 60 * 1000;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function toolVersion() {
  try {
    const out = execFileSync(EMCC, ['--version'], { encoding: 'utf8', timeout: 10000, env: CHILD_ENV });
    return out.trim().split('\n')[0];
  } catch {
    return 'unknown';
  }
}

function preflight() {
  try {
    execFileSync(EMCC, ['--version'], { stdio: 'ignore', timeout: 10000, env: CHILD_ENV });
  } catch {
    console.error(
      `Emscripten (emcc) not found: tried $EMCC, the in-repo emsdk/, and PATH. ` +
      `Install emsdk and run 'source emsdk_env.sh', or set EMSDK to the emsdk root.`
    );
    process.exit(1);
  }
}

// Build inputs: every .cpp/.h under native/ except the manifest and outputs.
function computeSourcesHash() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== 'build-manifest.json' && /\.(cpp|h|hpp)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(NATIVE_DIR);
  const lines = files
    .sort()
    .map((file) => `${relative(ROOT, file).split(sep).join('/')}\t${sha256(readFileSync(file))}`);
  lines.push(`tool\temcc@${toolVersion()}`);
  return sha256(lines.join('\n'));
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// The manifest returned only when inputs and both outputs all match.
function currentManifest() {
  const manifest = readManifest();
  if (manifest === null) return null;
  if (manifest.sourcesHash !== computeSourcesHash()) return null;
  if (!existsSync(WASM_FILE) || sha256(readFileSync(WASM_FILE)) !== manifest.wasmSha256) return null;
  if (!existsSync(JS_FILE) || sha256(readFileSync(JS_FILE)) !== manifest.jsSha256) return null;
  return manifest;
}

function reportUpToDate(manifest) {
  console.log(
    `solver.wasm up to date (sourcesHash ${manifest.sourcesHash.slice(0, 12)}); skipping rebuild`,
  );
}

async function acquireLock() {
  for (;;) {
    try {
      mkdirSync(LOCK);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    try {
      if (Date.now() - statSync(LOCK).mtimeMs > STALE_LOCK_MS) {
        rmSync(LOCK, { recursive: true, force: true });
      }
    } catch {
      // Lock vanished between the mkdir probe and the stat; retry directly.
    }
    await sleep(100);
  }
}

function buildOnce() {
  const tag = `${process.pid}-${Date.now()}`;
  const tmpWasm = join(DIST_DIR, `.build-tmp-solver-${tag}.wasm`);
  const tmpJs = join(DIST_DIR, `.build-tmp-solver-${tag}.js`);

  try {
    // Ensure dist/assets exists
    mkdirSync(DIST_DIR, { recursive: true });

    const cppFiles = [
      join(NATIVE_DIR, 'src', 'solver.cpp'),
      // Other .cpp files are included via #include in solver.cpp
    ];

    // Emscripten compile command
    // -O3: maximum optimization
    // -s WASM=1: emit WebAssembly
    // -s MODULARIZE=1: emit ES module
    // -s EXPORT_NAME=SolverModule: module name
    // -s EXPORTED_FUNCTIONS: list of C functions to export
    // -s EXPORTED_RUNTIME_METHODS: runtime methods needed (ccall, cwrap, etc.)
    // -s ALLOW_MEMORY_GROWTH=1: allow memory to grow
    // -s INITIAL_MEMORY=16MB: start with 16MB
    // -std=c++17: C++17 standard
    // -I: include directory
    execFileSync(
      EMCC,
      [
        cppFiles[0],
        '-o', tmpJs,
        '-O3',
        '-s', 'WASM=1',
        '-s', 'MODULARIZE=1',
        '-s', 'EXPORT_NAME=SolverModule',
        '-s', 'EXPORTED_FUNCTIONS=_solver_solve,_solver_free_solution,_solver_element_current,_solver_linearise_diode,_malloc,_free',
        '-s', 'EXPORTED_RUNTIME_METHODS=ccall,cwrap,getValue,setValue,HEAPF64,HEAP32,HEAP8',
        '-s', 'ALLOW_MEMORY_GROWTH=1',
        '-s', 'INITIAL_MEMORY=16777216',
        '-s', 'ENVIRONMENT=web,worker,node',
        '-s', 'DEFAULT_TO_CXX=1',
        '-std=c++17',
        '-I', join(NATIVE_DIR, 'include'),
        '-fno-exceptions',
        '-fno-rtti',
      ],
      { cwd: ROOT, stdio: 'inherit', timeout: 300000, env: CHILD_ENV },
    );

    // Replace committed artifacts only after compile succeeded
    renameSync(tmpJs, JS_FILE);
    // The .wasm file is created alongside .js by emcc
    const generatedWasm = tmpJs.replace('.js', '.wasm');
    renameSync(generatedWasm, WASM_FILE);

    const manifest = {
      file: 'solver.wasm',
      wasmSha256: sha256(readFileSync(WASM_FILE)),
      jsSha256: sha256(readFileSync(JS_FILE)),
      sourcesHash: computeSourcesHash(),
      toolchain: { emcc: toolVersion() },
    };
    const tmpManifest = `${MANIFEST_FILE}.tmp-${tag}`;
    writeFileSync(tmpManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tmpManifest, MANIFEST_FILE);

    console.log(
      `built solver.wasm (${statSync(WASM_FILE).size} bytes) + solver.js ` +
      `(${statSync(JS_FILE).size} bytes); sourcesHash ${manifest.sourcesHash}`,
    );
  } finally {
    rmSync(tmpWasm, { force: true });
    rmSync(tmpJs, { force: true });
    // Also clean up any .wasm temp file
    const tmpWasmFile = join(DIST_DIR, `.build-tmp-solver-${tag}.wasm`);
    rmSync(tmpWasmFile, { force: true });
  }
}

try {
  preflight();
  const manifest = currentManifest();
  if (manifest !== null) {
    reportUpToDate(manifest);
  } else {
    await acquireLock();
    try {
      const fresh = currentManifest();
      if (fresh !== null) reportUpToDate(fresh);
      else buildOnce();
    } finally {
      rmSync(LOCK, { recursive: true, force: true });
    }
  }
} catch (error) {
  console.error(`Solver wasm build failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}