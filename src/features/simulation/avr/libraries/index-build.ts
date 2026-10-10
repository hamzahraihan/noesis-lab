// Index entry build pipeline: fetch, SHA-256 verify, extract, per-TU compile,
// and cache an Arduino-index release through the same Tier-2 seam.
//
// selectIndexRelease is pure and fetch-free; buildIndexObjects takes
// { name, release } (not separate args) so the call site cannot pass a
// version the selector refused.
import { decodeTier2Map, encodeTier2Map, tier2CacheKey, type Tier2BuildResult, type Tier2Deps } from './tier2';
import { latestRelease, type IndexLibrary, type IndexRelease } from './index';

/** Pinned exact match, else semver-aware latest; null when missing or empty. No fetching. */
export function selectIndexRelease(lib: IndexLibrary, pinned?: string): IndexRelease | null {
  if (pinned !== undefined) return lib.versions.find((release) => release.version === pinned) ?? null;
  try {
    return latestRelease(lib);
  } catch {
    return null;
  }
}

export interface IndexBuildEntry {
  readonly name: string;
  readonly release: IndexRelease;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cacheDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

// NOTE (Tier-2-name-locked duplication): tier2.ts keeps its zip/extract/hash
// helpers private, so the crc/inflate/unzip/strip routines below are
// duplicated from there. Follow-up: export the shared archive helpers from a
// common module and delete this copy.
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

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const input = new Uint8Array(data.length);
  input.set(data);
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
async function unzipArchive(archive: Uint8Array, label: string): Promise<Map<string, Uint8Array>> {
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
 * strip it. Arduino 1.5 `src/`-layout archives stay `src/`-rooted rather
 * than being flattened — callers key headers by basename.
 */
function stripTopFolder(files: ReadonlyMap<string, Uint8Array>, label: string): Map<string, Uint8Array> {
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

export async function buildIndexObjects(
  entry: IndexBuildEntry,
  deps: Tier2Deps,
): Promise<Tier2BuildResult> {
  const { name, release } = entry;
  const resolved = `${name}@${release.version}`;
  const objectsKey = tier2CacheKey(name, release.version, 'objects');
  const headersKey = tier2CacheKey(name, release.version, 'headers');

  const [hitObjects, hitHeaders] = await Promise.all([
    deps.cache.get(objectsKey),
    deps.cache.get(headersKey),
  ]);
  if (hitObjects !== null && hitHeaders !== null) {
    const objects = decodeTier2Map(hitObjects);
    const headers = decodeTier2Map(hitHeaders);
    if (objects !== null && headers !== null) return { objects, headers };
  }

  const prefix = 'SHA-256:';
  if (!release.checksum.startsWith(prefix)) {
    throw new Error(`${resolved}: unsupported checksum scheme`);
  }
  const expected = release.checksum.slice(prefix.length).toLowerCase();

  const archive = await deps.fetch(release.url);
  if ((await sha256Hex(archive)).toLowerCase() !== expected) {
    throw new Error(`${resolved}: checksum mismatch, refusing`);
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
  if (sources.length === 0) throw new Error(`${resolved}: archive contains no .cpp/.c sources, refusing`);

  const decoder = new TextDecoder();
  const headerText = new Map<string, string>();
  for (const [headerName, headerBytes] of headers) headerText.set(headerName, decoder.decode(headerBytes));

  const objects = new Map<string, Uint8Array>();
  for (const source of sources) {
    const objectBytes = await deps.compileUnit(decoder.decode(source.bytes), headerText);
    objects.set(source.path.replace(/\.(cpp|c)$/, '.o'), objectBytes);
  }

  try {
    await deps.cache.put(objectsKey, encodeTier2Map(objects));
    await deps.cache.put(headersKey, encodeTier2Map(headers));
  } catch (error) {
    throw new Error(`${resolved}: cache unavailable (${cacheDetail(error)}), rebuild from network next time`);
  }
  return { objects, headers };
}
