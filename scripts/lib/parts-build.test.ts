import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPartsBuild, MANIFEST_NAMES, partsBuildTarget } from './parts-build.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SCRIPTS, '..');

const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

// A throwaway tree shaped like the repo: native sources, a header, and the file
// that carries the compiler flags.
const trees: string[] = [];

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), 'noesis-parts-build-'));
  trees.push(root);
  mkdirSync(join(root, 'native', 'src', 'parts'), { recursive: true });
  mkdirSync(join(root, 'native', 'include'), { recursive: true });
  writeFileSync(join(root, 'native', 'src', 'parts', 'parts.cpp'), 'int part_stamp() { return 0; }\n');
  writeFileSync(join(root, 'native', 'include', 'parts.h'), '#pragma once\n');
  const flagsFile = join(root, 'scripts', 'lib', 'parts-build.mjs');
  mkdirSync(dirname(flagsFile), { recursive: true });
  writeFileSync(flagsFile, "export const FLAGS = ['-O2'];\n");
  return { root, flagsFile };
}

// `emcc` deliberately does not exist: every check here must work without a compiler.
function buildFor(root: string, flagsFile: string) {
  return createPartsBuild(partsBuildTarget('wasm', root), {
    emcc: 'no-such-emcc-in-this-test',
    buildFiles: [flagsFile],
  });
}

afterEach(() => {
  for (const root of trees.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('parts build targets', () => {
  it('writes a separate manifest per entry point', () => {
    const wasm = partsBuildTarget('wasm');
    const probe = partsBuildTarget('probe');

    expect(MANIFEST_NAMES).toEqual({
      wasm: 'parts-wasm-manifest.json',
      probe: 'parts-probe-manifest.json',
    });
    expect(wasm.manifest).toBe(join(ROOT, 'native', 'parts-wasm-manifest.json'));
    expect(probe.manifest).toBe(join(ROOT, 'native', 'parts-probe-manifest.json'));
  });

  it('compiles both entry points to the same module the app loads', () => {
    const wasm = partsBuildTarget('wasm');
    const probe = partsBuildTarget('probe');

    expect(wasm.output).toBe(join(ROOT, 'src', 'features', 'parts', 'wasm', 'parts.wasm'));
    expect(probe.output).toBe(wasm.output);
  });

  it('rejects an unknown entry point instead of guessing a manifest', () => {
    expect(() => partsBuildTarget('bogus')).toThrow(/unknown parts build target/i);
  });
});

describe('cache key', () => {
  it('is a stable sha256 for an unchanged tree', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);

    expect(build.sourcesHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(build.sourcesHash()).toBe(build.sourcesHash());
  });

  it('changes when a C++ source changes', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    const before = build.sourcesHash();

    writeFileSync(join(root, 'native', 'src', 'parts', 'parts.cpp'), 'int part_stamp() { return 1; }\n');

    expect(build.sourcesHash()).not.toBe(before);
  });

  it('changes when a header changes', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    const before = build.sourcesHash();

    writeFileSync(join(root, 'native', 'include', 'parts.h'), '#pragma once\n#define N 1\n');

    expect(build.sourcesHash()).not.toBe(before);
  });

  it('changes when a file carrying the compiler flags changes', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    const before = build.sourcesHash();

    writeFileSync(flagsFile, "export const FLAGS = ['-O3'];\n");

    expect(build.sourcesHash()).not.toBe(before);
  });

  it('ignores files that are not build inputs', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    const before = build.sourcesHash();

    writeFileSync(join(root, 'native', 'notes.txt'), 'scratch\n');
    writeFileSync(join(root, 'native', 'parts-wasm-manifest.json'), '{"stale":true}\n');

    expect(build.sourcesHash()).toBe(before);
  });
});

describe('current manifest', () => {
  const writeOutput = (root: string, bytes: string) => {
    const output = partsBuildTarget('wasm', root).output;
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, bytes);
  };

  const writeManifest = (root: string, manifest: unknown) => {
    writeFileSync(partsBuildTarget('wasm', root).manifest, `${JSON.stringify(manifest)}\n`);
  };

  it('reports nothing to do when no manifest has been committed', () => {
    const { root, flagsFile } = makeTree();

    expect(buildFor(root, flagsFile).currentManifest()).toBeNull();
  });

  it('accepts a manifest whose key and output both match', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    writeOutput(root, 'wasm-bytes');
    writeManifest(root, { wasmSha256: sha256('wasm-bytes'), sourcesHash: build.sourcesHash() });

    expect(build.currentManifest()).not.toBeNull();
  });

  it('rejects a manifest whose output was rebuilt or tampered with', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    writeOutput(root, 'other-wasm-bytes');
    writeManifest(root, { wasmSha256: sha256('wasm-bytes'), sourcesHash: build.sourcesHash() });

    expect(build.currentManifest()).toBeNull();
  });

  it('rejects a manifest built from different sources', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    writeOutput(root, 'wasm-bytes');
    writeManifest(root, { wasmSha256: sha256('wasm-bytes'), sourcesHash: 'stale' });

    expect(build.currentManifest()).toBeNull();
  });
});

describe('entry points', () => {
  it('build:parts targets the parts-wasm manifest without compiling on import', async () => {
    const entry = await import('../build-parts-wasm.mjs');

    expect(entry.target.kind).toBe('wasm');
    expect(entry.target.manifest).toMatch(/parts-wasm-manifest\.json$/);
  });

  it('build:parts:probe targets the probe manifest without compiling on import', async () => {
    const entry = await import('../build-parts-probe.mjs');

    expect(entry.target.kind).toBe('probe');
    expect(entry.target.manifest).toMatch(/parts-probe-manifest\.json$/);
  });

  it('npm scripts point at the two entry points', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    expect(pkg.scripts['build:parts']).toBe('node scripts/build-parts-wasm.mjs');
    expect(pkg.scripts['build:parts:probe']).toBe('node scripts/build-parts-probe.mjs');
    for (const script of ['build-parts-wasm.mjs', 'build-parts-probe.mjs']) {
      expect(existsSync(join(SCRIPTS, script))).toBe(true);
    }
  });
});
