// Compiles the C++ part models to a raw wasm32 module for differential testing.
//
// Artifacts (committed build outputs):
//   - src/features/parts/wasm/parts.wasm
//   - native/parts-probe-manifest.json
//
// A committed manifest records a sha256 over the source, the exact compiler
// flags and the emcc version, plus the sha256 of the output. When the
// manifest, the inputs and the output all agree this script exits "up to
// date" without compiling, so the compiler runs once per source change, not
// once per test run. Tests read the committed artifact and never need emcc.
//
// The toolchain is emcc (Emscripten) with the wasm32 target.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_DIR = join(ROOT, 'native');
const SRC_DIR = join(NATIVE_DIR, 'src', 'parts');
const OUT_DIR = join(ROOT, 'src', 'features', 'parts', 'wasm');
const OUTPUT = join(OUT_DIR, 'parts.wasm');
const MANIFEST = join(NATIVE_DIR, 'parts-probe-manifest.json');
const EMCC = join(ROOT, 'emsdk', 'upstream', 'emscripten', 'emcc');

// Ensure emsdk node is on PATH for the child process (use forward slashes for PATH)
const EMSDK_NODE = join(ROOT, 'emsdk', 'node', '22.16.0_64bit', 'bin').replace(/\\/g, '/');
const CHILD_ENV = { ...process.env, PATH: `${EMSDK_NODE}:${process.env.PATH}` };

// The probe module is built with emcc which provides the C++ standard library.
// `-O2` is load-bearing: -O3 minifies exports to e,f,g... which the hand-written loader cannot address.
// `-sDEFAULT_TO_CXX=1` links against libc++ (needed for std::vector, unordered_map, etc.).
// `-Wl,--no-entry` tells the linker there is no main() function.
// `--allow-undefined` allows the three stubbed imports (abort, resize_heap, notify_memory_growth).
// `-sEXPORTED_FUNCTIONS` lists all C ABI functions the loader will call.
// `-sEXPORTED_RUNTIME_METHODS=[]` emits no JS glue.
// `-sENVIRONMENT=node` ensures Node.js compatible imports (wasi_snapshot_preview1).
const EXPORTED_FUNCTIONS = [
  // Part factories
  '_part_create_relay',
  '_part_create_servo',
  '_part_create_stepper',
  '_part_create_stepper_driver',
  '_part_create_shift_register',
  '_part_create_display_i2c',
  '_part_create_display_spi',
  '_part_create_7segment',
  '_part_create_lcd',
  '_part_create_i2c_expander',
  '_part_create_pwm_driver',
  '_part_create_rtc',
  '_part_create_sensor_i2c',
  '_part_create_dac',
  '_part_create_adc',
  '_part_create_thermocouple',
  '_part_create_rfid',
  '_part_create_neopixel',
  '_part_create_sonar',
  '_part_create_button',
  '_part_create_potentiometer',
  '_part_create_power_supply',
  // Bus
  '_i2c_bus_init',
  '_i2c_bus_begin',
  '_i2c_bus_begin_transmission',
  '_i2c_bus_write',
  '_i2c_bus_end_transmission',
  '_i2c_bus_request_from',
  '_i2c_bus_read',
  '_i2c_bus_available',
  '_i2c_bus_register_device',
  '_i2c_device_receive',
  '_i2c_device_read',
  '_spi_bus_init',
  '_spi_bus_begin',
  '_spi_bus_end',
  '_spi_bus_transfer',
  // Part runtime
  '_part_register',
  '_part_stamp',
  '_part_get_state',
  '_part_set_knob',
  '_part_set_pin_level',
  '_part_set_i2c_address',
  // Bus state
  '_bus_get_state',
  '_bus_reset',
  // Explicit global constructor for STL containers (needed with -Wl,--no-entry)
  '_init_globals',
];

const FLAGS = [
  '-O2',
  '-s', 'WASM=1',
  '-s', 'DEFAULT_TO_CXX=1',
  '-s', `EXPORTED_FUNCTIONS=${JSON.stringify(EXPORTED_FUNCTIONS)}`,
  '-s', 'EXPORTED_RUNTIME_METHODS=[]',
  '-s', 'ALLOW_MEMORY_GROWTH=1',
  '-s', 'INITIAL_MEMORY=16777216',
  '-s', 'ENVIRONMENT=node',
  '-s', 'INVOKE_RUN=0',
  '-std=c++17',
  '-I', join(NATIVE_DIR, 'include'),
  '-fno-exceptions',
  '-fno-rtti',
  '-Wl,--no-entry',
  '-Wl,--allow-undefined',
];

const SOURCE = join(SRC_DIR, 'parts.cpp');

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
      else if (entry.name !== 'parts-build-manifest.json' && entry.name !== 'parts-probe-manifest.json' && /\.(cpp|h|hpp)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(NATIVE_DIR);
  const lines = files
    .sort()
    .map((file) => `${relative(ROOT, file).split(sep).join('/')}\t${sha256(readFileSync(file))}`);
  // The build script carries the flags, so editing it must also invalidate the
  // cache; otherwise a rebuild silently keeps artifacts from the old flags.
  lines.push(`build\t${sha256(readFileSync(fileURLToPath(import.meta.url)))}`);
  lines.push(`tool\temcc@${toolVersion()}`);
  return sha256(lines.join('\n'));
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return null;
  }
}

function currentManifest() {
  const manifest = readManifest();
  if (manifest === null) return null;
  if (manifest.sourcesHash !== computeSourcesHash()) return null;
  if (!existsSync(OUTPUT) || sha256(readFileSync(OUTPUT)) !== manifest.wasmSha256) return null;
  return manifest;
}

function reportUpToDate(manifest) {
  console.log(
    `parts.wasm up to date (sourcesHash ${manifest.sourcesHash.slice(0, 12)}); skipping rebuild`,
  );
}

const LOCK = join(
  '/tmp',
  `noesis-lab-parts-probe-${createHash('sha256').update(ROOT).digest('hex').slice(0, 12)}.lock`,
);
const STALE_LOCK_MS = 5 * 60 * 1000;

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
    await new Promise((r) => setTimeout(r, 100));
  }
}

function buildOnce() {
  const tag = `${process.pid}-${Date.now()}`;
  const tmp = join(OUT_DIR, `.build-tmp-parts-${tag}.wasm`);

  try {
    mkdirSync(OUT_DIR, { recursive: true });

    execFileSync(
      EMCC,
      [...FLAGS, '-o', tmp, SOURCE],
      { cwd: ROOT, stdio: 'inherit', timeout: 300000, env: CHILD_ENV },
    );

    // Replace the committed artifact only after the compile succeeded, by
    // rename: a reader never observes a half-written module, and a failed
    // compile leaves the previous artifact intact.
    renameSync(tmp, OUTPUT);
    const manifest = {
      file: 'parts.wasm',
      wasmSha256: sha256(readFileSync(OUTPUT)),
      sourcesHash: computeSourcesHash(),
      toolchain: { emcc: toolVersion() },
    };
    const tmpManifest = `${MANIFEST}.tmp-${tag}`;
    writeFileSync(tmpManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tmpManifest, MANIFEST);
    console.log(
      `built parts.wasm (${statSync(OUTPUT).size} bytes); sourcesHash ${manifest.sourcesHash}`,
    );
  } finally {
    rmSync(tmp, { force: true });
  }
}

async function main() {
  try {
    preflight();
    const manifest = currentManifest();
    if (manifest !== null) reportUpToDate(manifest);
    else {
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
    console.error(`Parts probe build failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();