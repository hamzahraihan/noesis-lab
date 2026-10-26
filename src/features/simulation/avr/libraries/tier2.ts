// Tier-2 Arduino library fetch, verify, per-version object build, and cache.
//
// SevSeg + RTClib (see ./provided.ts) ship as Arduino-index .zip archives,
// not as toolchain objects, so each pinned version is fetched once, SHA-256
// verified against the manifest, extracted, compiled translation unit by
// translation unit through the injected compileUnit, and cached under
// versioned keys. Tasks 4-5 consume { objects, headers }; the production
// compileUnit (cc1plus -> avr-as pipeline) is injected via Tier2Deps so this
// module stays testable without WASM.
import { tier2ByName } from './provided';

export interface Tier2Deps {
  fetch: (url: string) => Promise<Uint8Array>;
  cache: {
    get(key: string): Promise<Uint8Array | null>;
    put(key: string, value: Uint8Array): Promise<void>;
  };
  compileUnit: (source: string, headers: ReadonlyMap<string, string>) => Promise<Uint8Array>;
}

export interface Tier2BuildResult {
  readonly objects: ReadonlyMap<string, Uint8Array>;
  readonly headers: ReadonlyMap<string, Uint8Array>;
}

// Production per-TU cc1plus flags, mirrored flag-for-flag from compileArgs()
// in node_modules/@horang-corp/avr-gcc-wasm/firmware-builder.js (package
// 0.2.0): same -D defines (MCU, F_CPU, ARDUINO, board), same -isystem system
// roots, same -I include roots for every bundled library — in particular
// -I .../Adafruit_BusIO, which RTClib needs via its `depends=Adafruit BusIO`
// declaration. Per-TU compile include paths must cover the toolchain headers
// or RTClib fails to build. Same codegen (-mmcu=avr5 -Os -std=gnu++11
// -fpermissive -fno-exceptions -fno-threadsafe-statics -fno-rtti
// -ffunction-sections -fdata-sections -mn-flash=1 -mno-skip-bug). Only the
// TU-specific slots differ: <tu.cpp>/<tu>/<tu.s> stand in for the package's
// /build/HorangFirmware.cpp/dumpbase/auxbase-strip/-o paths.
// The package runs cc1plus to assembly output then avr-as to the object, so
// the production compileUnit follows the same two stages:
//   cc1plus [...TIER2_CC1_FLAGS]       -> <tu.s>
//   avr-as  [...TIER2_AS_FLAGS, <tu.s>] -> <tu.o>
// driven exactly like the package's runTool/FS helpers: fetch
// tools/cc1plus.mjs text through FetchCache, import() it via
// URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
// (self-contained, no relative imports), instantiate with
// { noInitialRun: true, locateFile: (p) => <cached wasm object URL>,
// print(){}, printErr(l){} }, write each .cpp plus needed headers into
// mod.FS (ensureDir/writeFile), mod.callMain(args), read back the output.
export const TIER2_CC1_FLAGS: readonly string[] = Object.freeze([
  '-quiet',
  '-imultilib',
  'avr5',
  '-D__AVR_ATmega328P__',
  '-D__AVR_DEVICE_NAME__=atmega328p',
  '-DF_CPU=16000000L',
  '-DARDUINO=10819',
  '-DARDUINO_AVR_UNO',
  '-DARDUINO_ARCH_AVR',
  '-DUSE_OLED=0',
  '-DUSE_TOF=0',
  '-isystem',
  '/sysroot/gcc/include',
  '-isystem',
  '/sysroot/avr/include',
  '-I',
  '/arduino/core',
  '-I',
  '/arduino/variant',
  '-I',
  '/arduino/libraries/Wire/src',
  '-I',
  '/arduino/libraries/SPI/src',
  '-I',
  '/arduino/libraries/Wire/src/utility',
  '-I',
  '/libraries/Servo/src',
  '-I',
  '/libraries/Servo/src/avr',
  '-I',
  '/libraries/Firmata',
  '-I',
  '/libraries/Firmata/utility',
  '-I',
  '/libraries/Adafruit_BMP085_Library',
  '-I',
  '/libraries/DHT_sensor_library',
  '-I',
  '/libraries/Adafruit_GFX_Library',
  '-I',
  '/libraries/Adafruit_SSD1306',
  '-I',
  '/libraries/VL53L0X',
  '-I',
  '/libraries/Adafruit_BusIO',
  '-I',
  '/libraries/Adafruit_Unified_Sensor',
  '<tu.cpp>',
  '-mn-flash=1',
  '-mno-skip-bug',
  '-quiet',
  '-dumpbase',
  '<tu>',
  '-mmcu=avr5',
  '-auxbase-strip',
  '<tu.s>',
  '-Os',
  '-gdwarf-2',
  '-std=gnu++11',
  '-fpermissive',
  '-fno-exceptions',
  '-fno-threadsafe-statics',
  '-fno-rtti',
  '-fno-enforce-eh-specs',
  '-ffunction-sections',
  '-fdata-sections',
  '-o',
  '<tu.s>',
]);

/** Constant half of the package's avr-as argv (["-mmcu=atmega328p", "-o", out, in.s]). */
export const TIER2_AS_FLAGS: readonly string[] = Object.freeze(['-mmcu=atmega328p', '-g']);

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Cache-busting hash over the mirrored production flag lists above. */
export function tier2FlagsHash(): string {
  return fnv1a32(`${TIER2_CC1_FLAGS.join('\0')}${TIER2_AS_FLAGS.join('\0')}`);
}

export type Tier2CacheKind = 'objects' | 'headers' | 'archive';

export function tier2CacheKey(name: string, version: string, kind: Tier2CacheKind): string {
  return `lib/${name}/${version}/${tier2FlagsHash()}/${kind}`;
}

/** Length-prefixed map codec: u32 count, then u32 nameLen/name/u32 dataLen/data per entry. */
export function encodeTier2Map(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const records: Array<{ name: Uint8Array; data: Uint8Array }> = [];
  let total = 4;
  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name);
    records.push({ name: nameBytes, data });
    total += 4 + nameBytes.length + 4 + data.length;
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, records.length, true);
  let offset = 4;
  for (const record of records) {
    view.setUint32(offset, record.name.length, true);
    offset += 4;
    out.set(record.name, offset);
    offset += record.name.length;
    view.setUint32(offset, record.data.length, true);
    offset += 4;
    out.set(record.data, offset);
    offset += record.data.length;
  }
  return out;
}

/** Null on any truncation or bad UTF-8: callers treat that as a cache miss. */
export function decodeTier2Map(bytes: Uint8Array): Map<string, Uint8Array> | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    const take = (size: number): number => {
      if (offset + size > bytes.byteLength) throw new RangeError('truncated tier-2 cache entry');
      const at = offset;
      offset += size;
      return at;
    };
    const count = view.getUint32(take(4), true);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const out = new Map<string, Uint8Array>();
    for (let i = 0; i < count; i++) {
      const nameLen = view.getUint32(take(4), true);
      const nameAt = take(nameLen);
      const name = decoder.decode(bytes.subarray(nameAt, nameAt + nameLen));
      const dataLen = view.getUint32(take(4), true);
      const dataAt = take(dataLen);
      out.set(name, bytes.slice(dataAt, dataAt + dataLen));
    }
    return out;
  } catch {
    return null;
  }
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const input = new Uint8Array(data.length);
  input.set(data);
  // The read loop starts BEFORE the write: the readable queue is bounded,
  // so awaiting close() before the first read deadlocks once the output
  // exceeds it — and under Node the stalled stream holds no event-loop
  // handle, so the process exits silently instead of hanging loudly.
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  const pump = (async (): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  })();
  const writer = stream.writable.getWriter();
  await writer.write(input);
  await writer.close();
  writer.releaseLock();
  await pump;
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06050b50;

/** Minimal zip reader: local file headers, stored/deflated entries, CRC32-checked. */
export async function unzipArchive(
  archive: Uint8Array,
  label: string,
): Promise<Map<string, Uint8Array>> {
  const fail = (detail: string): Error => new Error(`${label}: ${detail}`);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  for (;;) {
    if (offset + 4 > archive.length) throw fail('archive is truncated, refusing');
    const sig = view.getUint32(offset, true);
    if (sig === ZIP_CENTRAL_SIG || sig === ZIP_EOCD_SIG) break;
    if (sig !== ZIP_LOCAL_SIG) throw fail('archive is not a zip file, refusing');
    if (offset + 30 > archive.length) throw fail('archive is truncated, refusing');
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compSize = view.getUint32(offset + 18, true);
    const uncompSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameLen + extraLen;
    if (dataStart + compSize > archive.length) throw fail('archive is truncated, refusing');
    if (flags & 0x08) throw fail('archive uses zip data descriptors, which are unsupported');
    const name = decoder.decode(archive.subarray(offset + 30, offset + 30 + nameLen));
    const data = archive.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;
    if (name.endsWith('/')) continue;
    if (name.startsWith('__MACOSX/')) continue;
    let bytes: Uint8Array;
    if (method === 0) bytes = new Uint8Array(data);
    else if (method === 8) bytes = await inflateRaw(data);
    else throw fail(`archive uses unsupported compression method ${method}, refusing`);
    if (bytes.length !== uncompSize) throw fail(`size mismatch for ${name}, refusing`);
    if (crc32(bytes) !== crc) throw fail(`checksum mismatch for ${name}, refusing`);
    files.set(name, bytes);
  }
  return files;
}

/**
 * Arduino archives nest everything under one `<Name>-<Version>/` folder;
 * strip it. RTClib additionally uses the Arduino 1.5 layout, so the stripped
 * tree stays `src/`-rooted (src/RTClib.h, src/RTClib.cpp) rather than being
 * flattened — callers key headers by basename.
 */
export function stripTopFolder(
  files: ReadonlyMap<string, Uint8Array>,
  label: string,
): Map<string, Uint8Array> {
  const fail = (detail: string): Error => new Error(`${label}: ${detail}`);
  const tops = new Set<string>();
  for (const name of files.keys()) {
    const slash = name.indexOf('/');
    if (slash < 0) throw fail(`archive entry ${name} is outside the top-level folder, refusing`);
    tops.add(name.slice(0, slash));
  }
  if (tops.size !== 1) throw fail('archive has no single top-level folder, refusing');
  const rooted = new Map<string, Uint8Array>();
  for (const [name, bytes] of files) rooted.set(name.slice(name.indexOf('/') + 1), bytes);
  return rooted;
}

export function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function cacheDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function buildTier2Objects(
  name: string,
  version: string | undefined,
  deps: Tier2Deps,
): Promise<Tier2BuildResult> {
  const entry = tier2ByName(name, version);
  if (entry === null) throw new Error(`${name}@${version ?? 'latest'}: unknown Tier-2 library`);
  const resolved = `${entry.name}@${entry.version}`;
  const objectsKey = tier2CacheKey(entry.name, entry.version, 'objects');
  const headersKey = tier2CacheKey(entry.name, entry.version, 'headers');
  const archiveKey = tier2CacheKey(entry.name, entry.version, 'archive');

  const [hitObjects, hitHeaders] = await Promise.all([
    deps.cache.get(objectsKey),
    deps.cache.get(headersKey),
  ]);
  if (hitObjects !== null && hitHeaders !== null) {
    const objects = decodeTier2Map(hitObjects);
    const headers = decodeTier2Map(hitHeaders);
    if (objects !== null && headers !== null) return { objects, headers };
  }

  let archive = await deps.cache.get(archiveKey);
  if (archive === null) {
    archive = await deps.fetch(entry.url);
    if ((await sha256Hex(archive)) !== entry.sha256) {
      throw new Error(`${resolved}: checksum mismatch, refusing`);
    }
    try {
      await deps.cache.put(archiveKey, archive);
    } catch (error) {
      throw new Error(
        `${resolved}: cache unavailable (${cacheDetail(error)}), rebuild from network next time`,
      );
    }
  }

  const rooted = stripTopFolder(await unzipArchive(archive, resolved), resolved);
  const sources: Array<{ path: string; bytes: Uint8Array }> = [];
  const headers = new Map<string, Uint8Array>();
  for (const [path, bytes] of rooted) {
    if (path.endsWith('.cpp') || path.endsWith('.c')) sources.push({ path, bytes });
    else if (path.endsWith('.h')) {
      const headerName = baseName(path);
      if (!headers.has(headerName)) headers.set(headerName, bytes);
    }
  }
  sources.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (sources.length === 0)
    throw new Error(`${resolved}: archive contains no .cpp/.c sources, refusing`);

  const decoder = new TextDecoder();
  const headerText = new Map<string, string>();
  for (const [headerName, headerBytes] of headers)
    headerText.set(headerName, decoder.decode(headerBytes));

  const objects = new Map<string, Uint8Array>();
  for (const source of sources) {
    const objectBytes = await deps.compileUnit(decoder.decode(source.bytes), headerText);
    objects.set(source.path.replace(/\.(cpp|c)$/, '.o'), objectBytes);
  }

  try {
    await deps.cache.put(objectsKey, encodeTier2Map(objects));
    await deps.cache.put(headersKey, encodeTier2Map(headers));
  } catch (error) {
    throw new Error(
      `${resolved}: cache unavailable (${cacheDetail(error)}), rebuild from network next time`,
    );
  }
  return { objects, headers };
}
