// Builds the committed alarm-clock Uno HEX via the pinned WASM toolchain.
//
// 1. Runs scripts/extract-alarm-sources.mts under vite-node (resolves the
//    repo's `@/` alias) to stage the verbatim gallery sources.
// 2. Packages those sources into the single translation unit with
//    `packageSketch` — via a vite-node script importing the real modules,
//    never a re-typed copy — and recomputes `sourcesHash` with the exact
//    `hex.test.ts` algorithm over the live gallery sources.
// 3. Static-serves the installed toolchain package on 127.0.0.1, points
//    `setAssetsBase` at it, and runs `buildFirmware({ source })` in-process.
// 4. Writes the HEX plus its manifest (`sha256` of the HEX bytes,
//    `sourcesHash` of the gallery sources the HEX was built from).
//
// Requires `npm install @horang-corp/avr-gcc-wasm@0.2.0` first: without the
// package on disk there is nothing to serve, so the script fails loudly
// instead of fabricating a HEX.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, '.avr-stage');
const PKG_DIR = join(ROOT, 'node_modules', '@horang-corp', 'avr-gcc-wasm');
const variant = (process.argv.find((a) => a.startsWith('--variant=')) ?? '').split('=')[1] === 'library' ? 'library' : undefined;
const HEX_PATH = variant === 'library'
  ? join(ROOT, 'src', 'features', 'simulation', 'avr', 'hex', 'alarm-clock-lib-uno.hex')
  : join(ROOT, 'src', 'features', 'simulation', 'avr', 'hex', 'alarm-clock-uno.hex');
const MANIFEST_PATH = variant === 'library'
  ? join(ROOT, 'src', 'features', 'simulation', 'avr', 'hex', 'alarm-clock-lib-manifest.json')
  : join(ROOT, 'src', 'features', 'simulation', 'avr', 'hex', 'manifest.json');

if (!existsSync(join(PKG_DIR, 'firmware-builder.js'))) {
  console.error(
    'AVR toolchain missing: run `npm install @horang-corp/avr-gcc-wasm@0.2.0` first, then re-run this script.',
  );
  process.exit(1);
}

function runViteNode(script, args = []) {
  execFileSync('npx', ['vite-node', script, ...args], { cwd: ROOT, stdio: 'inherit', shell: true });
}

const MIME = {
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
};

function contentType(path) {
  const dot = path.lastIndexOf('.');
  return (dot >= 0 && MIME[path.slice(dot)]) || 'application/octet-stream';
}

await mkdir(STAGE, { recursive: true });

// Step 1: verbatim gallery sources via the committed extractor.
runViteNode(join('scripts', 'extract-alarm-sources.mts'), variant === 'library' ? ['library'] : []);

// Step 2: package the TU + hash the sources with the real repo modules.
// vite-node 6 has no `-e` evaluation flag, so the snippet is materialized as
// a staging file (never committed) and executed with the repo's vite config,
// which resolves the `@/` alias exactly like vitest does.
const packagerSnippet = `import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildFor, firmwareForBuild, galleryById } from '../src/features/learn/gallery';
import { packageSketch } from '../src/features/simulation/avr/packager';

const build = buildFor(galleryById('alarm-clock')!, 'uno', VARIANT)!;
const tu = packageSketch(firmwareForBuild(build, 'arduino-cpp'));
const parts = [build.sketch, ...(build.files ?? []).map((f) => \`\${f.name}\\n\${f.content}\`)];
writeFileSync('.avr-stage/tu.json', JSON.stringify({
  source: tu.source,
  sourcesHash: createHash('sha256').update(parts.join('\\n')).digest('hex'),
}));
`.replace('VARIANT', variant === 'library' ? "'library'" : 'undefined');
const PACKAGER_SNIPPET = join(STAGE, 'package-tu.mts');
await writeFile(PACKAGER_SNIPPET, packagerSnippet);
runViteNode(join('.avr-stage', 'package-tu.mts'));

const { source, sourcesHash } = JSON.parse(await readFile(join(STAGE, 'tu.json'), 'utf8'));
const staged = JSON.parse(await readFile(join(STAGE, 'sources.json'), 'utf8'));
console.log(`staged sketch: ${staged.sketch.length} chars, ${staged.files.length} extra tabs; TU: ${source.length} chars`);

// Step 3: serve the toolchain package; the WASM compiler fetches its
// tools/ and assets/ over HTTP even when driven from Node.
const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const file = join(PKG_DIR, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    const stat = statSync(file, { throwIfNoEntry: false });
    if (!file.startsWith(PKG_DIR) || !stat?.isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    const bytes = readFileSync(file);
    res.writeHead(200, { 'content-type': contentType(file), 'content-length': bytes.length });
    res.end(bytes);
  } catch {
    try {
      res.writeHead(404).end('not found');
    } catch {
      // Response already closed; nothing left to report.
    }
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', 2048, resolve));
const port = server.address().port;
const assetsBase = `http://127.0.0.1:${port}/`;

let hex;
let fitsTarget = false;
try {
  // The toolchain pulls ~500 tiny headers in a single Promise.all burst;
  // bound client concurrency and retry transient loopback resets so the
  // burst survives on every platform. Retries cover network errors only —
  // HTTP statuses (e.g. a genuine 404) still surface immediately.
  const realFetch = globalThis.fetch.bind(globalThis);
  const MAX_FETCH_IN_FLIGHT = 32;
  let inFlight = 0;
  const waiters = [];
  const unthrottle = () => {
    inFlight--;
    const wake = waiters.shift();
    if (wake) wake();
  };
  globalThis.fetch = async (input, init) => {
    let lastError;
    for (let attempt = 0; attempt < 6; attempt++) {
      while (inFlight >= MAX_FETCH_IN_FLIGHT) await new Promise((wake) => waiters.push(wake));
      inFlight++;
      try {
        return await realFetch(input, init);
      } catch (error) {
        lastError = error;
      } finally {
        unthrottle();
      }
      await new Promise((wake) => setTimeout(wake, 100 * 2 ** attempt + Math.random() * 50));
    }
    throw lastError;
  };
  const toolchain = await import('@horang-corp/avr-gcc-wasm');
  toolchain.setAssetsBase(assetsBase);
  if (variant === 'library') {
    // Tier-2 assembly path: the single-TU buildFirmware({ source }) entry
    // cannot resolve <SevSeg.h>/<RTClib.h> (structural), so the library
    // variant compiles the multi-TU gallery project through the public
    // compileProjectWithLibraries seam, with Tier-2 objects built through
    // the injected per-TU toolchain adapter. Same materialize-and-run
    // vite-node pattern as Step 2 above. The in-memory cache backend is
    // constructed literally: createProjectLibraryContext wires IndexedDB,
    // which is unavailable in Node. The snippet additionally normalizes the
    // tabs' quoted "Arduino.h" include to the angle form (see inline note):
    // packageSketch drops quoted includes as local tabs, which would strip
    // the system header's declarations from the packed TU.
    const librarySnippet = `import { writeFileSync } from 'node:fs';
import { buildFor, firmwareForBuild, galleryById } from '../src/features/learn/gallery';
import { compileProjectWithLibraries } from '../src/features/simulation/avr/toolchain/client';
import { buildTier2Objects } from '../src/features/simulation/avr/libraries/tier2';
import { compileToolchainUnit } from '../src/features/simulation/avr/toolchain/tools';

const build = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
const rawProject = firmwareForBuild(build, 'arduino-cpp');
// packageSketch drops every quoted #include as a project-local tab, but the
// library tabs quote "Arduino.h" — a system header, not a tab. The TU-level
// <Arduino.h> backstop never fires (later tabs already use the angle form)
// and button.h packs first, so uint8_t/LOW/HIGH go missing and the TU fails
// (silently under runTool: the empty object surfaces only as undefined
// setup/loop at link). Normalize to the angle form the default build's tabs
// use: identical header, identical declarations, verbatim tab contents
// otherwise untouched.
const project = {
  ...rawProject,
  files: rawProject.files.map((f) => ({
    ...f,
    content: f.content.replace(/^\\s*#include\\s+"Arduino\\.h"\\s*$/gm, '#include <Arduino.h>'),
  })),
};
const mem = new Map();
const ctx = {
  slots: [],
  tier2: (name, version) => buildTier2Objects(name, version, {
    fetch: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(\`library fetch failed for \${url}: \${res.status}\`);
      return new Uint8Array(await res.arrayBuffer());
    },
    cache: {
      get: async (k) => mem.get(k) ?? null,
      put: async (k, v) => { mem.set(k, v); },
    },
    compileUnit: (source, headers) => compileToolchainUnit({ name: 'Tier2Unit.cpp', source, headers }),
  }),
};
const result = await compileProjectWithLibraries(project, ctx, () => {}, AbortSignal.timeout(1_200_000));
// result.hex is Uint16Array flash words: serialize to Intel HEX text,
// trimming trailing zero words, LF endings.
const words = [...result.hex];
while (words.length > 0 && words[words.length - 1] === 0) words.pop();
const bytes = Buffer.alloc(words.length * 2);
words.forEach((w, i) => { bytes[i * 2] = w & 0xff; bytes[i * 2 + 1] = (w >> 8) & 0xff; });
let hex = '';
for (let addr = 0; addr < bytes.length; addr += 16) {
  const chunk = bytes.subarray(addr, addr + 16);
  let sum = chunk.length + ((addr >> 8) & 0xff) + (addr & 0xff);
  let line = \`:\${chunk.length.toString(16).padStart(2, '0').toUpperCase()}\${addr.toString(16).padStart(4, '0').toUpperCase()}00\`;
  for (const b of chunk) { sum += b; line += b.toString(16).padStart(2, '0').toUpperCase(); }
  hex += line + (((~sum + 1) & 0xff).toString(16).padStart(2, '0').toUpperCase()) + '\\n';
}
hex += ':00000001FF\\n';
writeFileSync('.avr-stage/lib-hex.txt', hex);
`;
    const LIBRARY_SNIPPET = join(STAGE, 'build-library.mts');
    await writeFile(LIBRARY_SNIPPET, librarySnippet);
    runViteNode(join('.avr-stage', 'build-library.mts'));
    hex = await readFile(join(STAGE, 'lib-hex.txt'), 'utf8');
    // Mirror the toolchain's own budget check (firmware-builder.js:
    // flashBytes = countIntelHexDataBytes(hex), UNO_APP_FLASH_BYTES = 32256).
    let flashBytes = 0;
    for (const line of hex.split('\n')) {
      if (line[0] !== ':' || line.length < 11) continue;
      if (Number.parseInt(line.slice(7, 9), 16) === 0x00) {
        flashBytes += Number.parseInt(line.slice(1, 3), 16);
      }
    }
    fitsTarget = flashBytes <= 32256;
    console.log(`built (library): flash ${flashBytes} bytes (budget 32256), fitsTarget=${fitsTarget}`);
    if (!fitsTarget) {
      throw new Error('HEX overflows the Uno flash budget; refusing to commit it.');
    }
  } else {
  const result = await toolchain.buildFirmware({ source });
  hex = result.hex;
  fitsTarget = result.flashBytes <= result.target.appFlashBytes;
  console.log(
    `built: flash ${result.flashBytes} bytes (budget ${result.target.appFlashBytes}), ` +
      `HEX ${result.hexBytes} bytes, fitsTarget=${result.fitsTarget}`,
  );
  if (!result.fitsTarget) {
    throw new Error('HEX overflows the Uno flash budget; refusing to commit it.');
  }
  }
} catch (error) {
  console.error('buildFirmware failed:', error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
} finally {
  server.close();
}
if (hex === undefined) {
  console.error('buildFirmware returned no HEX; refusing to commit.');
  process.exit(1);
}

// Step 4: commit-ready artifacts. The toolchain emits CRLF line endings; normalize
// to LF before writing so the file, the blob, and the manifest agree on every
// checkout regardless of core.autocrlf (see .gitattributes `*.hex binary`,
// which is belt-and-braces for the same hazard). `sha256` covers the exact
// bytes written so `hex.test.ts` (which hashes the file) always agrees.
const normalizedHex = hex.replace(/\r\n/g, '\n');
await mkdir(dirname(HEX_PATH), { recursive: true });
await writeFile(HEX_PATH, normalizedHex);
const bytes = readFileSync(HEX_PATH);
await writeFile(
  MANIFEST_PATH,
  `${JSON.stringify(
    {
      file: variant === 'library' ? 'alarm-clock-lib-uno.hex' : 'alarm-clock-uno.hex',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sourcesHash,
    },
    null,
    2,
  )}\n`,
);
await rm(STAGE, { recursive: true, force: true });
console.log(`wrote ${HEX_PATH} (${bytes.length} bytes) + manifest (fitsTarget=${fitsTarget})`);
