// Compiles the C++ MNA solver (issue #20, phase 1) to wasm32 and skips the
// work when nothing changed.
//
// Artifacts are committed build outputs:
//   - src/features/simulation/engine-wasm/solver.wasm
//   - src/features/simulation/engine-wasm/build-manifest.json
//
// A committed manifest records a sha256 over the source, the exact compiler
// flags and the clang version, plus the sha256 of the output. When the
// manifest, the inputs and the output all agree this script exits "up to
// date" without compiling, so the compiler runs once per source change, not
// once per test run. Tests read the committed artifact and never need clang.
//
// The toolchain is the system clang with the wasm32 target (LLVM 15+); the
// repo does not vendor it. Set CLANG to an explicit executable when the
// default `clang++` on PATH is not the one you mean. Missing tools fail
// loudly with the remedy instead of installing silently.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src', 'features', 'simulation', 'engine-wasm');
const SOURCES = ['engine.cpp', 'solver.cpp', 'netlist.cpp', 'cpu.cpp', 'firmware.cpp'].map((file) =>
  join(DIR, file),
);
const OUTPUT = join(DIR, 'solver.wasm');
const MANIFEST = join(DIR, 'build-manifest.json');

// The solver is freestanding: no libc, no exceptions, no RTTI. `-fno-builtin`
// keeps the compiler from turning the explicit memcpy/memset into calls to
// themselves, and `-ffp-contract=off` keeps every product-then-add separate so
// the wasm path evaluates the same operations in the same order as the
// TypeScript parity oracle. `--allow-undefined` is only for js_exp/js_log1p,
// which the JS host supplies.
// Note: `--strip-all` requires wasm-opt (binaryen) which is not available on Windows.
const FLAGS = [
  '--target=wasm32',
  '-std=c++20',
  '-O2',
  '-fno-exceptions',
  '-fno-rtti',
  '-fno-builtin',
  '-ffp-contract=off',
  '-nostdlib',
  '-Wall',
  '-Wextra',
  '-Wl,--no-entry',
  '-Wl,--allow-undefined',
  '-Wl,--initial-memory=1048576',
  // '-Wl,--strip-all',  // requires wasm-opt (not available on Windows)
  '-Wl,--export=wasm_alloc',
  '-Wl,--export=set_profiles',
  '-Wl,--export=solve',
  '-Wl,--export=result_voltages',
  '-Wl,--export=result_source_currents',
  '-Wl,--export=result_iterations',
  '-Wl,--export=element_current',
  '-Wl,--export=build_netlist',
  '-Wl,--export=netlist_node_of_terminal',
  '-Wl,--export=netlist_node_count',
  '-Wl,--export=netlist_elements',
  '-Wl,--export=netlist_element_count',
  '-Wl,--export=netlist_labels',
  '-Wl,--export=cpu_step',
  '-Wl,--export=cpu_get_pc',
  '-Wl,--export=cpu_set_pc',
  '-Wl,--export=cpu_get_reg',
  '-Wl,--export=cpu_set_reg',
  '-Wl,--export=cpu_get_sreg',
  '-Wl,--export=cpu_set_sreg',
  '-Wl,--export=cpu_get_sp',
  '-Wl,--export=cpu_set_sp',
  '-Wl,--export=cpu_get_cycles',
  '-Wl,--export=cpu_set_cycles',
  '-Wl,--export=cpu_get_flash_capacity',
  '-Wl,--export=cpu_reset',
  '-Wl,--export=build_elements',
  '-Wl,--export=netlist_labels',
  '-Wl,--export=cpu_flash_base',
  '-Wl,--export=cpu_get_instructions',
  '-Wl,--export=vm_tokenize',
  '-Wl,--export=vm_parse',
  '-Wl,--export=vm_free_program',
  '-Wl,--export=vm_ast_to_json',
];


const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function findClang() {
  const candidates = [process.env.CLANG, 'clang++', 'clang++-20', 'clang++-19', 'clang++-18'].filter(
    Boolean,
  );
  for (const command of candidates) {
    try {
      const version = execFileSync(command, ['--version'], { encoding: 'utf8' })
        .trim();
      return { command, version };
    } catch {
      // Try the next candidate.
    }
  }
  console.error(
    'C++ wasm toolchain missing: install clang with the wasm32 target (LLVM 15+) ' +
      'or set CLANG=/path/to/clang++. The repo does not vendor a C++ compiler.',
  );
  process.exit(1);
}

function computeSourcesHash(toolchain) {
  const files = readdirSync(DIR)
    .filter((file) => /\.(cpp|h)$/.test(file))
    .sort();
  const lines = files.map(
    (file) => `${file}\t${sha256(readFileSync(join(DIR, file)))}`,
  );
  lines.push(`flags\t${FLAGS.join(' ')}`);
  lines.push(`tool\t${toolchain.version}`);
  return sha256(lines.join('\n'));
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return null;
  }
}

// The manifest returned only when the source, the flags, the compiler and the
// output all match: the artifact on disk then provably is the build of the
// source on disk.
function currentManifest(toolchain) {
  const manifest = readManifest();
  if (manifest === null) return null;
  if (manifest.sourcesHash !== computeSourcesHash(toolchain)) return null;
  if (!existsSync(OUTPUT) || sha256(readFileSync(OUTPUT)) !== manifest.sha256) return null;
  return manifest;
}

function reportUpToDate(manifest) {
  console.log(
    `solver.wasm up to date (sourcesHash ${manifest.sourcesHash.slice(0, 12)}); ` +
      'skipping rebuild',
  );
}

function buildOnce(toolchain) {
  const tag = `${process.pid}-${Date.now()}`;
  const tmp = join(DIR, `.build-tmp-solver-${tag}.wasm`);
  try {
    execFileSync(toolchain.command, [...FLAGS, '-o', tmp, ...SOURCES], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 120_000,
    });
    // Replace the committed artifact only after the compile succeeded, by
    // rename: a reader never observes a half-written module, and a failed
    // compile leaves the previous artifact intact.
    renameSync(tmp, OUTPUT);
    const manifest = {
      file: 'solver.wasm',
      sha256: sha256(readFileSync(OUTPUT)),
      sourcesHash: computeSourcesHash(toolchain),
      toolchain: { clang: toolchain.version },
    };
    const tmpManifest = `${MANIFEST}.tmp-${tag}`;
    writeFileSync(tmpManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tmpManifest, MANIFEST);
    console.log(
      `built solver.wasm (${statSync(OUTPUT).size} bytes); sourcesHash ${manifest.sourcesHash}`,
    );
  } finally {
    rmSync(tmp, { force: true });
  }
}

try {
  const missing = SOURCES.filter((source) => !existsSync(source));
  if (missing.length > 0) {
    console.error(`C++ engine source missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  const toolchain = findClang();
  const manifest = currentManifest(toolchain);
  if (manifest !== null) reportUpToDate(manifest);
  else buildOnce(toolchain);
} catch (error) {
  console.error(`C++ solver build failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
