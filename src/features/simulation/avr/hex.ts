import type { FirmwareProject } from '../firmware/project';

/**
 * Intel-HEX loader and committed-asset registry for the offline AVR path.
 *
 * The HEX files themselves are build artifacts: `scripts/build-avr-hex.sh`
 * compiles the gallery alarm sketch for `arduino:avr:uno` and commits the
 * result under `hex/` next to a manifest carrying the sketch sources hash.
 * This module bundles whatever `hex/` contains at build time via
 * `import.meta.glob` — an absent directory (no toolchain yet) globs to
 * nothing, so lookup simply reports no HEX and Simulation falls back to the
 * interpreter. Nothing here touches the filesystem, so it stays
 * browser-safe; the `node:fs` reads live in the tests only.
 */

/** ATmega328P flash: 32 KB, i.e. 16K little-endian words. */
export const UNO_FLASH_WORDS = 16384;
const UNO_FLASH_BYTES = UNO_FLASH_WORDS * 2;

function hexByte(line: string, index: number): number {
  return Number.parseInt(line.slice(index, index + 2), 16);
}

/**
 * Parses Intel-HEX text into Uno flash words (zero-padded; zeros are AVR
 * NOPs, so padding executes harmlessly).
 *
 * Record types 00 (data at linear base 0) and 01 (EOF) only. A type-04
 * extended-linear-address record is accepted solely with base 0 — the Uno's
 * flash lives there, so anything else addresses memory this chip does not
 * have. Every other record type throws `Error('unsupported HEX record')`,
 * and a bad checksum throws `Error('HEX checksum mismatch')`.
 */
export function parseIntelHex(text: string): Uint16Array {
  const image = new Uint8Array(UNO_FLASH_BYTES);
  const lines = text.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (!line.startsWith(':') || line.length < 11 || line.length % 2 === 0) {
      throw new Error(`invalid HEX line: ${line.slice(0, 32)}`);
    }
    const bytes: number[] = [];
    for (let i = 1; i < line.length; i += 2) {
      const byte = hexByte(line, i);
      if (Number.isNaN(byte)) throw new Error(`invalid HEX line: ${line.slice(0, 32)}`);
      bytes.push(byte);
    }
    const count = bytes[0]!;
    const address = (bytes[1]! << 8) | bytes[2]!;
    const kind = bytes[3]!;
    if (bytes.length !== 5 + count) throw new Error(`invalid HEX line: ${line.slice(0, 32)}`);
    let sum = 0;
    for (let i = 0; i < 4 + count; i++) sum += bytes[i]!;
    if (((sum + bytes[4 + count]!) & 0xff) !== 0) throw new Error('HEX checksum mismatch');
    const data = bytes.slice(4, 4 + count);
    if (kind === 0x00) {
      if (address + count > UNO_FLASH_BYTES) throw new Error('unsupported HEX record');
      image.set(data, address);
    } else if (kind === 0x01) {
      break;
    } else if (kind === 0x04) {
      // Extended linear address: only base 0 exists on this chip.
      if (count !== 2 || data[0] !== 0 || data[1] !== 0) {
        throw new Error('unsupported HEX record');
      }
    } else {
      throw new Error('unsupported HEX record');
    }
  }
  const words = new Uint16Array(UNO_FLASH_WORDS);
  for (let i = 0; i < UNO_FLASH_WORDS; i++) {
    words[i] = image[2 * i]! | (image[2 * i + 1]! << 8);
  }
  return words;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 as lowercase hex. Synchronous and dependency-free so the runtime hash gate works in the browser. */
export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const paddedLen = (Math.floor((bytes.length + 8) / 64) + 1) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bytes.length * 8);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const schedule = new Uint32Array(64);
  const rotr = (value: number, bits: number): number =>
    (value >>> bits) | (value << (32 - bits));
  for (let block = 0; block < paddedLen; block += 64) {
    for (let i = 0; i < 16; i++) schedule[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(schedule[i - 15]!, 7) ^ rotr(schedule[i - 15]!, 18) ^ (schedule[i - 15]! >>> 3);
      const s1 = rotr(schedule[i - 2]!, 17) ^ rotr(schedule[i - 2]!, 19) ^ (schedule[i - 2]! >>> 10);
      schedule[i] = (schedule[i - 16]! + s0 + schedule[i - 7]! + s1) | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i]! + schedule[i]!) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export interface HexManifest {
  readonly file: string;
  readonly sha256: string;
  readonly sourcesHash: string;
}

/** Whatever `hex/` held at build time: empty while the toolchain build is pending. */
const hexTexts = import.meta.glob('./hex/*.hex', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
const hexManifests = import.meta.glob('./hex/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, HexManifest>;

/**
 * Hashes a firmware project exactly the way `hex.test.ts` (and the build
 * script's manifest step) hash the gallery sources: entry sketch first, then
 * each extra tab as `name + '\n' + content`, joined with newlines. A committed
 * HEX applies to a project only when this matches its manifest, so a stale
 * HEX can never silently run newer sources — it falls back instead.
 */
export function sourcesHashForProject(project: FirmwareProject): string {
  const entry = project.files.find((file) => file.name === project.activeName)?.content ?? '';
  const rest = project.files
    .filter((file) => file.name !== project.activeName)
    .map((file) => `${file.name}\n${file.content}`);
  return sha256Hex([entry, ...rest].join('\n'));
}

/** Committed HEX text whose staged sources hash to `sourcesHash`, or null. */
export function hexForSourcesHash(sourcesHash: string): string | null {
  const byFile = new Map<string, string>();
  for (const [path, text] of Object.entries(hexTexts)) {
    byFile.set(path.split('/').pop() ?? path, text);
  }
  for (const manifest of Object.values(hexManifests)) {
    if (typeof manifest?.sourcesHash !== 'string' || typeof manifest?.file !== 'string') continue;
    if (manifest.sourcesHash !== sourcesHash) continue;
    const text = byFile.get(manifest.file);
    if (text !== undefined) return text;
  }
  return null;
}
