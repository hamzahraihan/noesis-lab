import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENGINE_EXPORTS } from './engine-exports.mjs';
import {
  buildFlags,
  createEngineFfiBuild,
  engineFfiSources,
  engineFfiTarget,
  exportedFunctions,
} from './engine-ffi-build.mjs';

const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

const trees: string[] = [];

const FFI_EXPORTS = [
  { name: 'engine_create', returns: 'int32_t', parameters: ['const char* circuit_json'] },
  { name: 'engine_step', returns: 'int32_t', parameters: ['int32_t handle', 'double dt_ms'] },
];

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), 'noesis-engine-ffi-'));
  trees.push(root);

  const engineDir = join(root, 'src', 'features', 'simulation', 'engine-wasm');
  mkdirSync(engineDir, { recursive: true });
  for (const file of ['engine.cpp', 'solver.cpp', 'netlist.cpp', 'cpu.cpp', 'firmware.cpp']) {
    writeFileSync(join(engineDir, file), `// ${file}\n`);
  }
  writeFileSync(join(engineDir, 'engine.h'), '#pragma once\n');

  mkdirSync(join(root, 'native', 'src'), { recursive: true });
  writeFileSync(join(root, 'native', 'src', 'engine_ffi_stub.cpp'), '// stub\n');
  mkdirSync(join(root, 'native', 'include'), { recursive: true });
  writeFileSync(join(root, 'native', 'include', 'ffi-generated.h'), '#pragma once\n');
  mkdirSync(join(root, 'native', 'abi'), { recursive: true });
  writeFileSync(
    join(root, 'native', 'abi', 'engine-ffi.schema.json'),
    `${JSON.stringify({ version: 1, ffi: { exports: FFI_EXPORTS } })}\n`,
  );

  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  const flagsFile = join(root, 'scripts', 'lib', 'engine-ffi-build.mjs');
  writeFileSync(flagsFile, "export const FLAGS = ['-O2'];\n");
  writeFileSync(join(root, 'scripts', 'lib', 'engine-js-library.js'), '// js library\n');

  return { root, flagsFile };
}

// `emcc` deliberately does not exist: every check here must work without a compiler.
function buildFor(root: string, flagsFile: string) {
  return createEngineFfiBuild(engineFfiTarget(root), {
    emcc: 'no-such-emcc-in-this-test',
    buildFiles: [flagsFile],
  });
}

afterEach(() => {
  for (const root of trees.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('engine FFI build target', () => {
  it('writes the browser module where Vite copies it from', () => {
    const target = engineFfiTarget(join('repo'));
    expect(target.outputJs).toBe(join('repo', 'public', 'assets', 'engine.js'));
    expect(target.outputWasm).toBe(join('repo', 'public', 'assets', 'engine.wasm'));
    expect(target.manifest).toBe(join('repo', 'native', 'engine-ffi-manifest.json'));
  });

  it('compiles the five engine units plus the FFI entry point', () => {
    const { root } = makeTree();
    const target = engineFfiTarget(root);
    expect(engineFfiSources(target)).toHaveLength(6);
    expect(engineFfiSources(target).at(-1)).toBe(target.stubEntry);
  });

  it('prefers the real entry point once ticket #56 adds it', () => {
    const { root } = makeTree();
    const target = engineFfiTarget(root);
    writeFileSync(target.mainEntry, '// real entry point\n');

    expect(engineFfiSources(target).at(-1)).toBe(target.mainEntry);
  });

  it('merges the shared core exports with the schema without duplicates', () => {
    const { root } = makeTree();
    const names = exportedFunctions(engineFfiTarget(root));

    for (const name of ENGINE_EXPORTS) expect(names).toContain(name);
    expect(names).toContain('engine_create');
    expect(names).toContain('engine_step');
    expect(new Set(names).size).toBe(names.length);
  });

  it('exports the Emscripten contract from the flags', () => {
    const { root } = makeTree();
    const flags = buildFlags(engineFfiTarget(root)).join(' ');

    expect(flags).toContain('-s MODULARIZE=1');
    expect(flags).toContain('-s EXPORT_ES6=1');
    expect(flags).toContain('-s ENVIRONMENT=web');
    expect(flags).toContain('-s ALLOW_MEMORY_GROWTH=1');
    expect(flags).toContain('-s MALLOC=none');
    expect(flags).toContain('INITIAL_MEMORY=33554432');
    expect(flags).toContain('MAXIMUM_MEMORY=536870912');
    expect(flags).toContain('_engine_create');
    expect(flags).toContain('_solve');
  });
});

describe('engine FFI cache key', () => {
  it('is a stable sha256 for an unchanged tree', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);

    expect(build.sourcesHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(build.sourcesHash()).toBe(build.sourcesHash());
  });

  it('changes when an engine source changes', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    const before = build.sourcesHash();

    writeFileSync(join(root, 'src', 'features', 'simulation', 'engine-wasm', 'solver.cpp'), '// changed\n');

    expect(build.sourcesHash()).not.toBe(before);
  });

  it('changes when the generated FFI header changes', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    const before = build.sourcesHash();

    writeFileSync(join(root, 'native', 'include', 'ffi-generated.h'), '#pragma once\n#define N 1\n');

    expect(build.sourcesHash()).not.toBe(before);
  });

  it('changes when the FFI schema changes', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    const before = build.sourcesHash();

    writeFileSync(
      join(root, 'native', 'abi', 'engine-ffi.schema.json'),
      `${JSON.stringify({ version: 1, ffi: { exports: [...FFI_EXPORTS, { name: 'engine_destroy' }] } })}\n`,
    );

    expect(build.sourcesHash()).not.toBe(before);
  });

  it('changes when a file carrying the flags changes', () => {
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
    writeFileSync(join(root, 'native', 'engine-ffi-manifest.json'), '{"stale":true}\n');

    expect(build.sourcesHash()).toBe(before);
  });
});

describe('engine FFI current manifest', () => {
  const writeOutputs = (root: string, wasm: string, js: string) => {
    const target = engineFfiTarget(root);
    mkdirSync(dirname(target.outputWasm), { recursive: true });
    writeFileSync(target.outputWasm, wasm);
    writeFileSync(target.outputJs, js);
  };

  const writeManifest = (root: string, manifest: unknown) => {
    writeFileSync(engineFfiTarget(root).manifest, `${JSON.stringify(manifest)}\n`);
  };

  it('reports nothing to do when no manifest has been committed', () => {
    const { root, flagsFile } = makeTree();

    expect(buildFor(root, flagsFile).currentManifest()).toBeNull();
  });

  it('accepts a manifest whose key and both outputs match', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    writeOutputs(root, 'wasm-bytes', 'js-bytes');
    writeManifest(root, {
      wasmSha256: sha256('wasm-bytes'),
      jsSha256: sha256('js-bytes'),
      sourcesHash: build.sourcesHash(),
    });

    expect(build.currentManifest()).not.toBeNull();
  });

  it('rejects a tampered wasm output', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    writeOutputs(root, 'other-wasm-bytes', 'js-bytes');
    writeManifest(root, {
      wasmSha256: sha256('wasm-bytes'),
      jsSha256: sha256('js-bytes'),
      sourcesHash: build.sourcesHash(),
    });

    expect(build.currentManifest()).toBeNull();
  });

  it('rejects a tampered glue output', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    writeOutputs(root, 'wasm-bytes', 'other-js-bytes');
    writeManifest(root, {
      wasmSha256: sha256('wasm-bytes'),
      jsSha256: sha256('js-bytes'),
      sourcesHash: build.sourcesHash(),
    });

    expect(build.currentManifest()).toBeNull();
  });

  it('rejects a manifest built from different sources', () => {
    const { root, flagsFile } = makeTree();
    const build = buildFor(root, flagsFile);
    writeOutputs(root, 'wasm-bytes', 'js-bytes');
    writeManifest(root, {
      wasmSha256: sha256('wasm-bytes'),
      jsSha256: sha256('js-bytes'),
      sourcesHash: 'stale',
    });

    expect(build.currentManifest()).toBeNull();
  });
});

describe('engine FFI entry point', () => {
  it('build:engine:ffi targets the browser module without compiling on import', async () => {
    const entry = await import('../build-engine-ffi-wasm.mjs');
    const target = engineFfiTarget();

    expect(target.outputWasm).toMatch(/public[\\/]assets[\\/]engine\.wasm$/);
    expect(entry).toBeDefined();
  });

  it('npm scripts point at the entry point and the build depends on it', () => {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'));

    expect(pkg.scripts['build:engine:ffi']).toBe('node scripts/build-engine-ffi-wasm.mjs');
    expect(pkg.scripts.build).toContain('npm run build:engine:ffi');
    expect(pkg.scripts.prepare).toContain('npm run generate:ffi');
  });
});
