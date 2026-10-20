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
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const UPSTREAM = 'https://github.com/mikroverk/esp32sim.git';
const COMMIT = '964c26c1a6dac335e849195d2cabc15c713015a3';
const ROOT = resolve(import.meta.dirname, '..');
const PATCH = join(ROOT, 'src/features/simulation/esp32/patches/esp32sim-gpio-seam.patch');
const TARGET = join(ROOT, 'src/features/simulation/esp32/firmware/esp32sim.wasm');
const MANIFEST = join(ROOT, 'src/features/simulation/esp32/firmware/manifest.json');

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

const work = mkdtempSync(join(tmpdir(), 'esp32sim-'));
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
}
