// Compiles the AVR Wasm core and the counter fixture with the pinned,
// locally-installed toolchain — and skips the work when nothing changed.
//
// Artifacts are committed build outputs:
//   - src/features/simulation/avr/wasm/avr-core.wasm  (AssemblyScript core)
//   - src/features/simulation/avr/wasm/counter.wasm   (wat2wasm fixture)
//
// A committed build-manifest.json beside them records a sha256 over every
// build input (the wasm *.ts sources, counter.wat, tsconfig.json,
// op-rank.json, plus the exact asc/wat2wasm versions) and the sha256 of both
// outputs. When the manifest, the inputs, and the outputs all agree this
// script exits "up to date" without compiling — the compiler runs once per
// source change, not once per test run. The three wasm leg tests build in
// parallel, so concurrent invocations single-flight through a lock in the OS
// temp dir: one process compiles, the rest wait, re-check, and skip.
//
// Tools are the repo's own devDependencies (assemblyscript, wabt); nothing
// is fetched with npx and nothing is installed during a build. Missing
// dependencies fail loudly with the remedy instead of installing silently.
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
const WASM_DIR = join(ROOT, 'src', 'features', 'simulation', 'avr', 'wasm');
const CORE = join(WASM_DIR, 'avr-core.wasm');
const COUNTER = join(WASM_DIR, 'counter.wasm');
const MANIFEST = join(WASM_DIR, 'build-manifest.json');
const ASC = join(ROOT, 'node_modules', 'assemblyscript', 'bin', 'asc.js');
const WAT2WASM = join(ROOT, 'node_modules', 'wabt', 'bin', 'wat2wasm');

// Rebuilds take seconds; a lock this old means the holder died mid-build.
const LOCK = join(
  tmpdir(),
  `noesis-lab-avr-wasm-${createHash('sha256').update(ROOT).digest('hex').slice(0, 12)}.lock`,
);
const STALE_LOCK_MS = 5 * 60 * 1000;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function toolVersion(pkg) {
  return JSON.parse(readFileSync(join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')).version;
}

function preflight() {
  const missing = [
    [ASC, 'assemblyscript'],
    [WAT2WASM, 'wabt'],
  ].filter(([path]) => !existsSync(path));
  if (missing.length > 0) {
    console.error(
      `AVR wasm toolchain missing (${missing.map(([, name]) => name).join(', ')}): ` +
        'run `npm install` first, then re-run this script.',
    );
    process.exit(1);
  }
}

// Build inputs: every .ts/.wat/.json under the wasm dir except the manifest
// and the .wasm outputs themselves (the temp names the build writes are
// covered by the same filter). Paths are hashed as repo-relative POSIX paths
// so the hash does not depend on the checkout location.
function computeSourcesHash() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== 'build-manifest.json' && /\.(ts|wat|json)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(WASM_DIR);
  const lines = files
    .sort()
    .map((file) => `${relative(ROOT, file).split(sep).join('/')}\t${sha256(readFileSync(file))}`);
  lines.push(`tool\tassemblyscript@${toolVersion('assemblyscript')}`);
  lines.push(`tool\twabt@${toolVersion('wabt')}`);
  return sha256(lines.join('\n'));
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return null;
  }
}

// The manifest returned only when inputs and both outputs all match: the
// artifacts on disk then provably are the build of the sources on disk.
function currentManifest() {
  const manifest = readManifest();
  if (manifest === null) return null;
  if (manifest.sourcesHash !== computeSourcesHash()) return null;
  if (!existsSync(CORE) || sha256(readFileSync(CORE)) !== manifest.sha256) return null;
  if (!existsSync(COUNTER) || sha256(readFileSync(COUNTER)) !== manifest.counter?.sha256)
    return null;
  return manifest;
}

function reportUpToDate(manifest) {
  console.log(
    `avr-core.wasm up to date (sourcesHash ${manifest.sourcesHash.slice(0, 12)}); ` +
      'skipping rebuild',
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
  const tmpCore = join(WASM_DIR, `.build-tmp-core-${tag}.wasm`);
  const tmpCounter = join(WASM_DIR, `.build-tmp-counter-${tag}.wasm`);
  try {
    execFileSync(process.execPath, [WAT2WASM, join(WASM_DIR, 'counter.wat'), '-o', tmpCounter], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 120_000,
    });
    execFileSync(
      process.execPath,
      [ASC, join(WASM_DIR, 'index.ts'), '--outFile', tmpCore, '--optimize', '--memoryBase', '35328'],
      { cwd: ROOT, stdio: 'inherit', timeout: 240_000 },
    );
    // Replace committed artifacts only after both compiles succeeded, by
    // rename: readers (parallel test files) never observe a half-written
    // module, and a failed compile leaves the previous artifacts intact.
    renameSync(tmpCounter, COUNTER);
    renameSync(tmpCore, CORE);
    const manifest = {
      file: 'avr-core.wasm',
      sha256: sha256(readFileSync(CORE)),
      sourcesHash: computeSourcesHash(),
      counter: { file: 'counter.wasm', sha256: sha256(readFileSync(COUNTER)) },
      toolchain: { assemblyscript: toolVersion('assemblyscript'), wabt: toolVersion('wabt') },
    };
    const tmpManifest = `${MANIFEST}.tmp-${tag}`;
    writeFileSync(tmpManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tmpManifest, MANIFEST);
    console.log(
      `built avr-core.wasm (${statSync(CORE).size} bytes) + counter.wasm ` +
        `(${statSync(COUNTER).size} bytes); sourcesHash ${manifest.sourcesHash}`,
    );
  } finally {
    rmSync(tmpCore, { force: true });
    rmSync(tmpCounter, { force: true });
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
      // The builder we waited on has just rebuilt everything; skip now.
      const fresh = currentManifest();
      if (fresh !== null) reportUpToDate(fresh);
      else buildOnce();
    } finally {
      rmSync(LOCK, { recursive: true, force: true });
    }
  }
} catch (error) {
  console.error(`AVR wasm build failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
