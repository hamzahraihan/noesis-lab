// Native compile gate: nothing in CI compiled native/, so a C++ break (a
// duplicate factory definition, a language-linkage mismatch) shipped green and
// only surfaced when someone ran emcc by hand. Syntax-check every translation
// unit with the same flags the wasm builds use.
import { spawnSync } from 'node:child_process';

import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const include = join(root, 'native', 'include');
// The wasm builds compile one entry point each; the other .cpp files in
// native/src are pulled in with #include, so they are not separate units.
const entryPoints = [
  join(root, 'native', 'src', 'solver.cpp'),
  join(root, 'native', 'src', 'parts', 'parts.cpp'),
];
const candidates = [process.env.CXX, 'clang++', 'g++', 'c++'].filter(Boolean);
const cxx = candidates.find(
  (compiler) => spawnSync(compiler, ['--version'], { stdio: 'ignore' }).status === 0,
);
if (!cxx) {
  console.warn('check-native: no C++ compiler on PATH, skipping');
  process.exit(0);
}

const errors = [];
for (const file of entryPoints) {
  const result = spawnSync(
    cxx,
    [
      '-std=c++17',
      '-fno-exceptions',
      '-fno-rtti',
      // MSVC's <cmath> hides M_PI without this; musl (the wasm target) does not.
      '-D_USE_MATH_DEFINES',
      '-fsyntax-only',
      '-I', include,
      file,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.error?.message || '').trim();
    errors.push(`${relative(root, file).split('\\').join('/')}\n${detail}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n\n'));
  process.exit(1);
}
console.log(`native ok (${entryPoints.length} units, ${cxx})`);
