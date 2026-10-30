/**
 * Compiles the C++ firmware interpreter to WebAssembly via Emscripten.
 *
 * Artifacts (committed build outputs):
 *   - dist/assets/firmware.wasm
 *   - dist/assets/firmware.js (glue code)
 *
 * A committed build-manifest.json records a sha256 over every build input
 * and the sha256 of both outputs.
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_DIR = join(ROOT, 'native');
const DIST_DIR = join(ROOT, 'dist', 'assets');
const WASM_FILE = join(DIST_DIR, 'firmware.wasm');
const JS_FILE = join(DIST_DIR, 'firmware.js');
const MANIFEST_FILE = join(NATIVE_DIR, 'firmware-build-manifest.json');
const EMCC = 'emcc';

const LOCK = join(
  tmpdir(),
  `noesis-lab-firmware-wasm-${createHash('sha256').update(ROOT).digest('hex').slice(0, 12)}.lock`,
);
const STALE_LOCK_MS = 5 * 60 * 1000;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function toolVersion() {
  try {
    const out = execFileSync(EMCC, ['--version'], { encoding: 'utf8', timeout: 10000 });
    return out.trim().split('\n')[0];
  } catch {
    return 'unknown';
  }
}

function preflight() {
  try {
    execFileSync(EMCC, ['--version'], { stdio: 'ignore', timeout: 10000 });
  } catch {
    console.error(
      `Emscripten (emcc) not found in PATH. ` +
      `Install emsdk and run 'source emsdk_env.sh' or add to PATH.`
    );
    process.exit(1);
  }
}

function computeSourcesHash() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== 'firmware-build-manifest.json' && /\.(cpp|h|hpp)$/.test(entry.name)) {
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
    `firmware.wasm up to date (sourcesHash ${manifest.sourcesHash.slice(0, 12)}); skipping rebuild`,
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
    }
    await sleep(100);
  }
}

function buildOnce() {
  const tag = `${process.pid}-${Date.now()}`;
  const tmpJs = join(DIST_DIR, `.build-tmp-firmware-${tag}.js`);
  const tmpWasm = join(DIST_DIR, `.build-tmp-firmware-${tag}.wasm`);

  try {
    mkdirSync(DIST_DIR, { recursive: true });

    const cppFiles = [
      join(NATIVE_DIR, 'src', 'firmware', 'firmware.cpp'),
    ];

    execFileSync(
      EMCC,
      [
        cppFiles[0],
        '-o', tmpJs,
        '-O3',
        '-s', 'WASM=1',
        '-s', 'MODULARIZE=1',
        '-s', 'EXPORT_NAME=FirmwareModule',
        '-s', 'EXPORTED_FUNCTIONS=_firmware_parser_create,_firmware_parser_destroy,_firmware_parse_arduino,_firmware_parse_python,_firmware_parse_error,_firmware_vm_create,_firmware_vm_destroy,_firmware_vm_run,_firmware_vm_get_debug_state,_firmware_vm_free_debug_state,_firmware_vm_set_breakpoint,_firmware_vm_clear_breakpoint,_firmware_vm_step_over,_firmware_vm_step_into,_firmware_vm_resume,_firmware_vm_load_sketch,_firmware_value_destroy,_firmware_string_destroy,_firmware_array_destroy,_firmware_dict_destroy,_firmware_run_sketch,_malloc,_free',
        '-s', 'EXPORTED_RUNTIME_METHODS=ccall,cwrap,getValue,setValue,HEAPF64,HEAP32,HEAP8',
        '-s', 'ALLOW_MEMORY_GROWTH=1',
        '-s', 'INITIAL_MEMORY=33554432',
        '-s', 'ENVIRONMENT=web,worker,node',
        '-s', 'DEFAULT_TO_CXX=1',
        '-std=c++17',
        '-I', join(NATIVE_DIR, 'include'),
        '-fno-exceptions',
        '-fno-rtti',
      ],
      { cwd: ROOT, stdio: 'inherit', timeout: 600000 },
    );

    renameSync(tmpJs, JS_FILE);
    const generatedWasm = tmpJs.replace('.js', '.wasm');
    renameSync(generatedWasm, WASM_FILE);

    const manifest = {
      file: 'firmware.wasm',
      wasmSha256: sha256(readFileSync(WASM_FILE)),
      jsSha256: sha256(readFileSync(JS_FILE)),
      sourcesHash: computeSourcesHash(),
      toolchain: { emcc: toolVersion() },
    };
    const tmpManifest = `${MANIFEST_FILE}.tmp-${tag}`;
    writeFileSync(tmpManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tmpManifest, MANIFEST_FILE);

    console.log(
      `built firmware.wasm (${statSync(WASM_FILE).size} bytes) + firmware.js ` +
      `(${statSync(JS_FILE).size} bytes); sourcesHash ${manifest.sourcesHash}`,
    );
  } finally {
    rmSync(tmpWasm, { force: true });
    rmSync(tmpJs, { force: true });
    const tmpWasmFile = join(DIST_DIR, `.build-tmp-firmware-${tag}.wasm`);
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
  console.error(`Firmware wasm build failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}