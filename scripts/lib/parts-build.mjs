// Shared compile/cache/manifest logic for the C++ part models.
//
// Two entry points use it and differ only in the manifest they write:
//   - scripts/build-parts-wasm.mjs  -> native/parts-wasm-manifest.json (npm run build:parts)
//   - scripts/build-parts-probe.mjs -> native/parts-probe-manifest.json (npm run build:parts:probe)
//
// Both compile the same sources with the same flags to the same committed
// artifact, src/features/parts/wasm/parts.wasm. The manifests stay separate so
// the differential tests keep reading a file whose meaning they own.
//
// A committed manifest records a sha256 over the sources, the exact compiler
// flags and the emcc version, plus the sha256 of the output. When the manifest,
// the inputs and the output all agree the script exits "up to date" without
// compiling, so the compiler runs once per source change, not once per test
// run. Tests read the committed artifact and never need emcc.
//
// The toolchain is emcc (Emscripten) with the wasm32 target.
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
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildChildEnv } from '../child-env.mjs';

// This file carries the flags, so its own hash is part of the cache key.
const LIB_FILE = fileURLToPath(import.meta.url);

export const ROOT = join(dirname(LIB_FILE), '..', '..');

// One manifest per entry point; the differential tests own the probe one.
export const MANIFEST_NAMES = Object.freeze({
  wasm: 'parts-wasm-manifest.json',
  probe: 'parts-probe-manifest.json',
});

/**
 * Layout for one entry point. Throws on an unknown kind rather than silently
 * falling back to a manifest someone else's tests read.
 */
export function partsBuildTarget(kind, root = ROOT) {
  if (!Object.hasOwn(MANIFEST_NAMES, kind)) {
    throw new Error(`Unknown parts build target: ${String(kind)}`);
  }
  return {
    kind,
    root,
    nativeDir: join(root, 'native'),
    output: join(root, 'src', 'features', 'parts', 'wasm', 'parts.wasm'),
    manifest: join(root, 'native', MANIFEST_NAMES[kind]),
  };
}

// The module is built with emcc which provides the C++ standard library.
// `-O2` is load-bearing: -O3 minifies exports to e,f,g... which the hand-written loader cannot address.
// `-sDEFAULT_TO_CXX=1` links against libc++ (needed for std::vector, unordered_map, etc.).
// `-Wl,--no-entry` tells the linker there is no main() function.
// `--allow-undefined` allows the three stubbed imports (abort, resize_heap, notify_memory_growth).
// `-sEXPORTED_FUNCTIONS` lists all C ABI functions the loader will call.
// `-sEXPORTED_RUNTIME_METHODS=[]` emits no JS glue.
// `-sENVIRONMENT=node` ensures Node.js compatible imports (wasi_snapshot_preview1).
export const EXPORTED_FUNCTIONS = Object.freeze([
  // Part factories
  '_part_create_relay',
  '_part_create_servo',
  '_part_create_stepper',
  '_part_create_stepper_driver',
  '_part_create_shift_register',
  '_part_create_display_i2c',
  '_part_create_display_spi',
  '_part_create_display_pcd8544',
  '_part_create_7segment',
  '_part_create_lcd',
  '_part_create_i2c_expander',
  '_part_create_pwm_driver',
  '_part_create_rtc',
  '_part_create_sensor_i2c',
  '_part_create_dac',
  '_part_create_adc',
  '_part_create_thermocouple',
  '_part_create_eeprom',
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
  // SPI callbacks (must be in function table for indirect calls)
  '_spi_pcd8544_receive',
  // Explicit global constructor for STL containers (needed with -Wl,--no-entry)
  '_init_globals',
]);

/** The exact emcc invocation, shared by every entry point. */
export function buildFlags(target) {
  return [
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
    '-I', join(target.nativeDir, 'include'),
    '-fno-exceptions',
    '-fno-rtti',
    '-Wl,--no-entry',
    '-Wl,--allow-undefined',
    '-Wl,--no-gc-sections',
  ];
}

export const SOURCE_FILE = (target) => join(target.nativeDir, 'src', 'parts', 'parts.cpp');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// emcc comes from an emsdk that may or may not live inside the repo, so resolve
// it instead of hardcoding one layout. Order: $EMCC, the emsdk root ($EMSDK when
// set, otherwise <root>/emsdk), then plain 'emcc' from PATH. A missing
// candidate falls through to the next one rather than failing here.
function emsdkRoots(root) {
  const roots = [];
  if (process.env.EMSDK) roots.push(process.env.EMSDK);
  roots.push(join(root, 'emsdk'));
  return roots;
}

// emsdk ships its own node; emcc needs it on PATH. The versioned directory name
// changes with the sdk release, so look for any <root>/node/*/bin (Unix) or
// <root>/node/* holding node.exe (Windows, where the sdk drops the bin/ layer).
function emsdkNodeBin(root) {
  const nodeRoot = join(root, 'node');
  try {
    for (const entry of readdirSync(nodeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const versioned = join(nodeRoot, entry.name);
      const bin = join(versioned, 'bin');
      if (existsSync(bin)) return bin;
      if (existsSync(join(versioned, 'node.exe'))) return versioned;
    }
  } catch {
    // No node/ directory in this sdk: nothing to prepend.
  }
  return null;
}

// The sdk's launcher is `emcc` on Unix and `emcc.exe` on Windows; execFileSync
// resolves neither an extension nor a shebang by itself, so name both.
const EMCC_NAMES = process.platform === 'win32' ? ['emcc.exe', 'emcc'] : ['emcc'];

function resolveEmcc(root) {
  if (process.env.EMCC) return process.env.EMCC;
  for (const sdkRoot of emsdkRoots(root)) {
    for (const name of EMCC_NAMES) {
      const candidate = join(sdkRoot, 'upstream', 'emscripten', name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'emcc';
}

// buildChildEnv owns the platform PATH separator (';' on Windows, ':' elsewhere);
// a hardcoded ':' there collapsed the whole PATH into one entry and emcc could
// not find node.
function childEnv(root) {
  return buildChildEnv(emsdkRoots(root).map(emsdkNodeBin).find((bin) => bin !== null));
}

/** True when `moduleUrl` is the file node was started with, not an import. */
export function isEntryPoint(moduleUrl) {
  const entry = process.argv[1];
  return entry !== undefined && moduleUrl === pathToFileURL(entry).href;
}

/**
 * A build for one target. Everything that can be checked without a compiler
 * (`sourcesHash`, `currentManifest`) is plain fs + hashing, so tests never
 * need emcc.
 *
 * `buildFiles` are the files whose contents carry the flags; each one is part
 * of the cache key so editing them invalidates stale artifacts.
 */
export function createPartsBuild(
  target,
  { emcc = resolveEmcc(target.root), buildFiles = [LIB_FILE], lockDir = tmpdir() } = {},
) {
  const env = childEnv(target.root);

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
        `Emscripten (emcc) not found: tried $EMCC, ${emsdkRoots(target.root)
          .map((root) => join(root, 'upstream', 'emscripten', 'emcc'))
          .join(', ')} and PATH. ` +
        `Install emsdk (https://emscripten.org/docs/getting_started/downloads.html) ` +
        `and run 'source emsdk_env.sh', or set EMSDK to the emsdk root.`,
      );
      process.exit(1);
    }
  };

  // Build inputs: every .cpp/.h/.hpp under native/ (the manifests are .json and
  // are written by this script, so they must stay out of the key), plus the
  // files that carry the flags and the tool version.
  const sourcesHash = () => {
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(cpp|h|hpp)$/.test(entry.name)) files.push(full);
      }
    };
    walk(target.nativeDir);
    const lines = files
      .sort()
      .map((file) => `${relative(target.root, file).split(sep).join('/')}\t${sha256(readFileSync(file))}`);
    // The flags live in a script, not in the sources, so editing that script must
    // also invalidate the cache; otherwise a rebuild silently keeps artifacts
    // from the old flags.
    for (const file of buildFiles) {
      lines.push(`build\t${sha256(readFileSync(file))}`);
    }
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

  // The manifest is only current when its key, the inputs and the output agree.
  const currentManifest = () => {
    const manifest = readManifest();
    if (manifest === null) return null;
    if (manifest.sourcesHash !== sourcesHash()) return null;
    if (!existsSync(target.output) || sha256(readFileSync(target.output)) !== manifest.wasmSha256) {
      return null;
    }
    return manifest;
  };

  const reportUpToDate = (manifest) => {
    console.log(
      `parts.wasm up to date (sourcesHash ${manifest.sourcesHash.slice(0, 12)}); skipping rebuild`,
    );
  };

  const lock = join(
    lockDir,
    `noesis-lab-parts-${createHash('sha256').update(target.root).digest('hex').slice(0, 12)}.lock`,
  );
  const STALE_LOCK_MS = 5 * 60 * 1000;

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
    const outDir = dirname(target.output);
    const tmp = join(outDir, `.build-tmp-parts-${tag}.wasm`);

    try {
      mkdirSync(outDir, { recursive: true });

      execFileSync(emcc, [...buildFlags(target), '-o', tmp, SOURCE_FILE(target)], {
        cwd: target.root,
        stdio: 'inherit',
        timeout: 300000,
        env,
      });

      // Replace the committed artifact only after the compile succeeded, by
      // rename: a reader never observes a half-written module, and a failed
      // compile leaves the previous artifact intact.
      renameSync(tmp, target.output);
      const manifest = {
        file: 'parts.wasm',
        wasmSha256: sha256(readFileSync(target.output)),
        sourcesHash: sourcesHash(),
        toolchain: { emcc: toolVersion() },
      };
      const tmpManifest = `${target.manifest}.tmp-${tag}`;
      writeFileSync(tmpManifest, `${JSON.stringify(manifest, null, 2)}\n`);
      renameSync(tmpManifest, target.manifest);
      console.log(
        `built parts.wasm (${statSync(target.output).size} bytes); sourcesHash ${manifest.sourcesHash}`,
      );
    } finally {
      rmSync(tmp, { force: true });
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
        `Parts build failed (${target.kind}): ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    }
  };

  return { target, flags: buildFlags(target), sourcesHash, currentManifest, buildOnce, run };
}

/** Entry point body: build the given target, or exit non-zero saying why not. */
export async function runPartsBuild(target) {
  await createPartsBuild(target).run();
}
