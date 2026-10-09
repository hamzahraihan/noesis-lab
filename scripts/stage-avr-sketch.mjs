// Regenerates .avr-stage/alarm/ from the gallery alarm-clock sources.
//
// The staged tree is what scripts/build-avr-hex.sh compiles: alarm.ino (the
// gallery `sketch` content verbatim), one file per gallery tab verbatim, plus
// shim.h/shim.cpp copied byte for byte. Sources are copied WITHOUT rewrites
// — byte for byte, including whatever line endings the gallery file holds —
// so the HEX manifest's sourcesHash (over the staged bytes) always matches
// the hex.test.ts hash (over the gallery strings) on the same checkout. Any
// drift fails loudly here instead of shipping a stale HEX.
//
// Line-ending rule: staged files are normalized to LF. The runtime gallery
// strings (hence both hashes) always carry LF: Vite/esbuild normalizes every
// line break in template literals to \n when it transforms gallery.ts, no
// matter what the checkout materializes on disk (CRLF on Windows). Raw byte
// copies would therefore hash differently from the test on a CRLF checkout.
// Normalizing here keeps the manifest checkout-independent: the same gallery
// content yields the same sourcesHash on every machine.
//
// Runs on plain node with zero dependencies: gallery.ts is parsed as text
// (template-literal scanning with exact JS unescaping), never imported.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GALLERY = join(ROOT, 'src', 'features', 'learn', 'gallery.ts');
const STAGE = join(ROOT, '.avr-stage', 'alarm');
const SHIM_DIR = join(ROOT, 'src', 'features', 'simulation', 'avr', 'shim');

// Gallery tabs in manifest order (must match the python `order` in
// build-avr-hex.sh after 'alarm.ino').
const TABS = ['config.h', 'button.h', 'button.cpp', 'clock.h', 'clock.cpp', 'alarmtone.h', 'alarmtone.cpp'];

function fail(message) {
  console.error(`stage-avr-sketch: ${message}`);
  process.exit(1);
}

// Read the template literal starting at `backtick` (index of the opening
// backtick) and return { value, end } where `end` is the index just past the
// closing backtick. Unescaping follows JS template semantics exactly; any
// construct that needs evaluation aborts instead of drifting.
function readTemplateLiteral(source, backtick, label) {
  let out = '';
  let i = backtick + 1;
  const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
  while (i < source.length) {
    const ch = source[i];
    if (ch === '`') return { value: out, end: i + 1 };
    if (ch === '$' && source[i + 1] === '{') {
      fail(`${label}: interpolation (\${...) needs evaluation; refusing to guess`);
    }
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    const next = source[i + 1];
    if (next === undefined) fail(`${label}: unterminated escape at end of file`);
    if (next in simple) {
      out += simple[next];
      i += 2;
      continue;
    }
    if (next === '`' || next === '$' || next === '\\' || next === "'" || next === '"') {
      out += next;
      i += 2;
      continue;
    }
    if (next === '\n') {
      i += 2; // line continuation: backslash-newline vanishes
      continue;
    }
    if (next === '\r' && source[i + 2] === '\n') {
      i += 3;
      continue;
    }
    if (next === 'x' || next === 'u') {
      // \xHH, \uHHHH, \u{H+}: decode via JSON (covers \uHHHH); braced
      // unicode would need evaluation, so refuse it.
      if (next === 'u' && source[i + 2] === '{') {
        fail(`${label}: braced unicode escape needs evaluation; refusing to guess`);
      }
      const len = next === 'x' ? 4 : 6;
      const raw = source.slice(i, i + len);
      if (!/\\x[0-9a-fA-F]{2}/.test(raw) && !/\\u[0-9a-fA-F]{4}/.test(raw)) {
        fail(`${label}: malformed escape ${JSON.stringify(raw)}`);
      }
      out += JSON.parse(`"${raw}"`);
      i += len;
      continue;
    }
    fail(`${label}: unsupported escape ${JSON.stringify(source.slice(i, i + 2))}; refusing to guess`);
  }
  fail(`${label}: unterminated template literal`);
}

// Find `key:` after `from`, then the template literal assigned to it.
function readKeyedLiteral(source, key, from, label) {
  const keyAt = source.indexOf(key, from);
  if (keyAt === -1) fail(`${label}: key ${JSON.stringify(key)} missing`);
  const tick = source.indexOf('`', keyAt + key.length);
  if (tick === -1) fail(`${label}: no template literal after ${JSON.stringify(key)}`);
  return { ...readTemplateLiteral(source, tick, label), keyAt };
}

const gallery = readFileSync(GALLERY, 'utf8');
const alarmAt = gallery.indexOf('const ALARM_CLOCK');
if (alarmAt === -1) fail('ALARM_CLOCK block missing in gallery.ts');
const blockEnd = gallery.indexOf('const SAFE', alarmAt);
if (blockEnd === -1) fail('ALARM_CLOCK block end anchor (const SAFE) missing in gallery.ts');
const block = gallery.slice(alarmAt, blockEnd);

const sketch = readKeyedLiteral(block, 'sketch:', 0, 'alarm.ino');
const files = new Map();
let cursor = 0;
for (const name of TABS) {
  const nameKey = `name: '${name}'`;
  const nameAt = block.indexOf(nameKey, cursor);
  if (nameAt === -1) fail(`gallery tab missing: ${name}`);
  const content = readKeyedLiteral(block, 'content:', nameAt + nameKey.length, name);
  files.set(name, content.value);
  cursor = content.end;
}
if (files.size !== TABS.length) fail(`expected ${TABS.length} tabs, found ${files.size}`);

mkdirSync(STAGE, { recursive: true });
// LF normalization (see rule above): cooked JS template literals always use
// \n, so the staged sources must too. \r\n and lone \r both become \n.
const toLf = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
writeFileSync(join(STAGE, 'alarm.ino'), toLf(sketch.value));
for (const name of TABS) writeFileSync(join(STAGE, name), toLf(files.get(name)));
for (const shim of ['shim.h', 'shim.cpp']) {
  const from = join(SHIM_DIR, shim);
  try {
    copyFileSync(from, join(STAGE, shim));
  } catch {
    fail(`shim source missing: ${from}`);
  }
}

console.log(`staged alarm sketch: alarm.ino + ${TABS.length} tabs + shim.h/shim.cpp -> .avr-stage/alarm/`);
