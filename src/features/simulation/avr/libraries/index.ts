// Arduino library index fetch, cache, parse, search, and version select.
//
// The index (library_index.json.gz, ~54k per-release rows) is fetched from
// the Arduino CDN, gunzipped with native DecompressionStream('gzip'),
// grouped per library name, and cached raw in the injected IDB store under
// `arduino-index/<fetch-date-ISO>` with an `arduino-index/lastChecked`
// stamp. Entries under 7 days old serve immediately with zero fetches; the
// background refresh path is an explicit refreshIndex() call so cached
// reads stay deterministic. Corrupt bytes are deleted and refetched once;
// a second failure surfaces a named index error.
import type { IDBBackend } from '../toolchain/cache';

export const INDEX_URL = 'http://downloads.arduino.cc/libraries/library_index.json.gz';
export const INDEX_FALLBACK_URL = 'https://downloads.arduino.cc/libraries/library_index.json.gz';

export interface IndexRelease {
  readonly version: string;
  readonly url: string;
  readonly checksum: string;
  readonly size: number;
}

export interface IndexLibrary {
  readonly name: string;
  readonly versions: readonly IndexRelease[];
  readonly author: string;
  readonly sentence: string;
  readonly category: string;
  readonly architectures: readonly string[];
  readonly providesIncludes: readonly string[];
}

export interface FetchIndexDeps {
  readonly store: IDBBackend;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
}

const LAST_CHECKED_KEY = 'arduino-index/lastChecked';
const DATA_KEY_PREFIX = 'arduino-index/';
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_LIMIT = 50;

function indexError(detail: unknown): Error {
  const text = detail instanceof Error ? detail.message : String(detail);
  return new Error(`library index unreadable (${text})`);
}

/** Numeric dot-separated segments, or null when any segment is non-numeric. */
function numericSegments(version: string): number[] | null {
  if (!/^\d+(\.\d+)*$/.test(version)) return null;
  return version.split('.').map((part) => parseInt(part, 10));
}

/**
 * Positive when a is newer than b. Any numeric version beats any
 * non-numeric tag, so non-semver releases sort last and are never latest.
 */
function compareReleaseVersions(a: string, b: string): number {
  const na = numericSegments(a);
  const nb = numericSegments(b);
  if (na !== null && nb !== null) {
    const len = Math.max(na.length, nb.length);
    for (let i = 0; i < len; i += 1) {
      const x = i < na.length ? na[i] : 0;
      const y = i < nb.length ? nb[i] : 0;
      if (x !== y) return x - y;
    }
    return 0;
  }
  if (na !== null) return 1;
  if (nb !== null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver-aware latest; non-semver tags never win. Throws when empty. */
export function latestRelease(lib: IndexLibrary): IndexRelease {
  let best: IndexRelease | null = null;
  for (const release of lib.versions) {
    if (best === null || compareReleaseVersions(release.version, best.version) > 0) best = release;
  }
  if (best === null) throw new Error(`${lib.name}: no releases in index`);
  return best;
}

/**
 * Case-insensitive substring over name/sentence/providesIncludes, ranked
 * name-prefix > name-substring > includes-match > sentence-match, 50-row cap.
 */
export function searchIndex(
  libs: readonly IndexLibrary[],
  query: string,
  opts?: { category?: string },
): IndexLibrary[] {
  const needle = query.toLowerCase();
  const ranked: Array<{ lib: IndexLibrary; rank: number }> = [];
  for (const lib of libs) {
    if (opts?.category !== undefined && lib.category !== opts.category) continue;
    const name = lib.name.toLowerCase();
    let rank = -1;
    if (name.startsWith(needle)) rank = 0;
    else if (name.includes(needle)) rank = 1;
    else if (lib.providesIncludes.some((header) => header.toLowerCase().includes(needle))) rank = 2;
    else if (lib.sentence.toLowerCase().includes(needle)) rank = 3;
    else continue;
    ranked.push({ lib, rank });
  }
  ranked.sort(
    (a, b) => a.rank - b.rank || (a.lib.name < b.lib.name ? -1 : a.lib.name > b.lib.name ? 1 : 0),
  );
  return ranked.slice(0, SEARCH_LIMIT).map((entry) => entry.lib);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('gzip');
  const input = new Uint8Array(bytes.length);
  input.set(bytes);
  // The read loop starts BEFORE the write: the readable queue is bounded,
  // so awaiting close() before the first read deadlocks once the output
  // exceeds it (same shape as the Tier-2 deflate-raw inflate path).
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  const pump = (async (): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  })();
  // The reader loop rejects with the same root cause when the writable
  // side reports the failure first; handle it here so the abandoned pump
  // never surfaces as an unhandled rejection (the await below rethrows).
  pump.catch(() => {});
  const writer = stream.writable.getWriter();
  try {
    await writer.write(input);
    await writer.close();
  } finally {
    writer.releaseLock();
  }
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

interface RawIndexRow {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly author?: unknown;
  readonly sentence?: unknown;
  readonly category?: unknown;
  readonly architectures?: unknown;
  readonly providesIncludes?: unknown;
  readonly url?: unknown;
  readonly checksum?: unknown;
  readonly size?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Groups flat per-release rows per library name, versions newest-first. */
function parseIndex(json: string): IndexLibrary[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (error) {
    throw indexError(error);
  }
  if (
    typeof doc !== 'object' ||
    doc === null ||
    !Array.isArray((doc as { libraries?: unknown }).libraries)
  ) {
    throw indexError('missing libraries array');
  }
  const rows = (doc as { libraries: unknown[] }).libraries;
  const groups = new Map<string, RawIndexRow[]>();
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const typed = row as RawIndexRow;
    if (typeof typed.name !== 'string' || typeof typed.version !== 'string') continue;
    const group = groups.get(typed.name);
    if (group === undefined) groups.set(typed.name, [typed]);
    else group.push(typed);
  }
  const libs: IndexLibrary[] = [];
  for (const [name, group] of groups) {
    const sorted = [...group].sort((a, b) =>
      compareReleaseVersions(b.version as string, a.version as string),
    );
    const head = sorted[0];
    libs.push({
      name,
      versions: sorted.map((row) => ({
        version: row.version as string,
        url: asString(row.url),
        checksum: asString(row.checksum),
        size: typeof row.size === 'number' ? row.size : 0,
      })),
      author: asString(head.author),
      sentence: asString(head.sentence),
      category: asString(head.category),
      architectures: asStringArray(head.architectures),
      providesIncludes: asStringArray(head.providesIncludes),
    });
  }
  return libs;
}

async function gunzipAndParse(gz: Uint8Array): Promise<IndexLibrary[]> {
  try {
    return parseIndex(new TextDecoder().decode(await gunzip(gz)));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('library index unreadable')) throw error;
    throw indexError(error);
  }
}

/** Primary then fallback origin; corrupt payloads fall through to the next origin. */
async function fetchAndParse(
  deps: FetchIndexDeps,
): Promise<{ libs: IndexLibrary[]; gz: Uint8Array }> {
  const fetchFn = deps.fetchFn ?? fetch;
  let detail = 'unknown error';
  for (const url of [INDEX_URL, INDEX_FALLBACK_URL]) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        detail = `fetch failed for ${url}: ${res.status}`;
        continue;
      }
      const gz = new Uint8Array(await res.arrayBuffer());
      return { libs: await gunzipAndParse(gz), gz };
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`library index unreadable (${detail})`);
}

async function storeFresh(deps: FetchIndexDeps, gz: Uint8Array, iso: string): Promise<void> {
  const previous = await deps.store.get(LAST_CHECKED_KEY);
  await deps.store.put(`${DATA_KEY_PREFIX}${iso}`, gz);
  await deps.store.put(LAST_CHECKED_KEY, new TextEncoder().encode(iso));
  if (previous !== null) {
    const oldIso = new TextDecoder().decode(previous);
    if (oldIso !== iso) await deps.store.delete(`${DATA_KEY_PREFIX}${oldIso}`);
  }
}

/**
 * Stale-while-revalidate read: a stamp under 7 days old serves the cached
 * gunzip with zero fetches (background refresh is an explicit
 * refreshIndex() call). Older, missing, or corrupt entries fetch once,
 * store, and return; a failed refetch throws the named index error.
 */
export async function fetchIndex(deps: FetchIndexDeps): Promise<IndexLibrary[]> {
  const now = deps.now ?? Date.now;
  const checkedBytes = await deps.store.get(LAST_CHECKED_KEY);
  if (checkedBytes !== null) {
    const checked = Date.parse(new TextDecoder().decode(checkedBytes));
    if (!Number.isNaN(checked) && now() - checked < FRESH_MS) {
      const dataKey = `${DATA_KEY_PREFIX}${new TextDecoder().decode(checkedBytes)}`;
      const cached = await deps.store.get(dataKey);
      if (cached !== null) {
        try {
          return await gunzipAndParse(cached);
        } catch {
          await deps.store.delete(dataKey);
          await deps.store.delete(LAST_CHECKED_KEY);
        }
      } else {
        await deps.store.delete(LAST_CHECKED_KEY);
      }
    }
  }
  const fresh = await fetchAndParse(deps);
  await storeFresh(deps, fresh.gz, new Date(now()).toISOString());
  return fresh.libs;
}

/** Force-refresh path: always fetches, stores, and returns the new rows. */
export async function refreshIndex(deps: FetchIndexDeps): Promise<IndexLibrary[]> {
  const now = deps.now ?? Date.now;
  const fresh = await fetchAndParse(deps);
  await storeFresh(deps, fresh.gz, new Date(now()).toISOString());
  return fresh.libs;
}
