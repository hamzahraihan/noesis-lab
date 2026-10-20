/**
 * Builds the ESP32 emulator's WebAssembly module.
 *
 * The module is upstream's, with one local patch: the GPIO seam a bench needs
 * to read what the chip drives and to drive what it reads. The build is
 * reproducible -- a pinned upstream commit, the pinned patch, and upstream's own
 * build script -- so the module committed under
 * `src/features/simulation/esp32/firmware/` can be rebuilt and checked
 * against the hash the manifest records.
 *
 * Needs a Rust toolchain with the `wasm32-unknown-unknown` target, and a
 * shell for upstream's `tools/wasm-build.sh` (bash: git bash on Windows, bash
 * on Linux). A cold clone and build take about two and a half minutes.
 *
 *   node scripts/build-esp32-wasm.mjs
 *
 * ## Where the writes go
 *
 * A Rust toolchain, a clone and a cargo target directory are gigabytes of
 * writes, and a laptop SSD pays for every one of them. So this script keeps
 * them off the system drive: the clone and the cargo target land under
 * `NOESIS_SCRATCH` (default `G:\Temp\noesis-build\scratch` on Windows, the
 * system temp elsewhere), and `CARGO_HOME`, `RUSTUP_HOME` and
 * `CARGO_TARGET_DIR` point at the same root for the child process. The
 * operator's own environment is set the same way (see the handoff), so a
 * manual `cargo build` lands there too.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const UPSTREAM = 'https://github.com/mikroverk/esp32sim.git';
const COMMIT = '964c26c1a6dac335e849195d2cabc15c713015a3';
const ROOT = resolve(import.meta.dirname, '..');
const PATCH = join(ROOT, 'src/features/simulation/esp32/patches/esp32sim-gpio-seam.patch');
const TARGET = join(ROOT, 'src/features/simulation/esp32/firmware/esp32sim.wasm');
const MANIFEST = join(ROOT, 'src/features/simulation/esp32/firmware/manifest.json');

/**
 * Where the heavy writes go.
 *
 * A drive that is not the system drive, when the operator has one: the
 * scratch lives on the disk that can absorb writes without spending the
 * SSD's endurance.
 */
const SCRATCH =
  process.env.NOESIS_SCRATCH ??
  (process.platform === 'win32' ? 'G:\\Temp\\noesis-build\\scratch' : tmpdir());

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      CARGO_HOME: join(SCRATCH, '..', 'cargo'),
      RUSTUP_HOME: join(SCRATCH, '..', 'rustup'),
      CARGO_TARGET_DIR: join(SCRATCH, '..', 'cargo-target'),
    },
  });
}

mkdirSync(SCRATCH, { recursive: true });
const work = mkdtempSync(join(SCRATCH, 'esp32sim-'));
try {
  run('git', ['clone', '--filter=blob:none', UPSTREAM, work]);
  run('git', ['checkout', COMMIT], work);
  run('git', ['apply', PATCH], work);
  run('bash', ['tools/wasm-build.sh'], work);

  const built = join(work, 'web/wasm/esp32sim.wasm');
  const bytes = readFileSync(built);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(TARGET, bytes);

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const entry = manifest.artifacts.find((artifact) => artifact.file === 'esp32sim.wasm');
  if (!entry) throw new Error('the manifest has no esp32sim.wasm entry');
  console.log(`esp32sim.wasm: ${bytes.length} bytes, sha256 ${sha256}`);
  if (entry.sha256 !== sha256) {
    console.log(`the manifest records ${entry.sha256}`);
    console.log('update the manifest if the build is the new reference');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  // The clone is gone; the cargo target directory is not, because a rebuild
  // would reuse it. It is scratch by name, and the operator can delete it.
  if (!existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true, force: true });
}
