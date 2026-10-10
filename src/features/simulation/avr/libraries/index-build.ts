// Index entry build pipeline: fetch, SHA-256 verify, extract, per-TU compile,
// and cache an Arduino-index release through the same Tier-2 seam.
//
// selectIndexRelease is pure and fetch-free; buildIndexObjects takes
// { name, release } (not separate args) so the call site cannot pass a
// version the selector refused.
//
// Archive helpers (baseName/cacheDetail/decode/encode/sha256/strip/unzip),
// the cache key/codec, and the Tier2Deps/Tier2BuildResult types are the
// Tier-2 originals imported from ./tier2 — no local copies.
import {
  baseName,
  cacheDetail,
  decodeTier2Map,
  encodeTier2Map,
  sha256Hex,
  stripTopFolder,
  tier2CacheKey,
  unzipArchive,
  type Tier2BuildResult,
  type Tier2Deps,
} from './tier2';
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

export interface IndexReinstallDeps extends Tier2Deps {
  readonly cache: Tier2Deps['cache'] & { delete(key: string): Promise<void> };
}

/**
 * Reinstall path (spec §2): evicts the exact-key entry first, so a reinstall
 * always refetches + rebuilds. A silent cache-hit no-op here would leave a
 * stale or corrupt build in place. Plain installs keep using
 * buildIndexObjects, whose verified no-op on a hit is the deduplication rule.
 */
export async function reinstallIndexObjects(
  entry: IndexBuildEntry,
  deps: IndexReinstallDeps,
): Promise<Tier2BuildResult> {
  const resolved = `${entry.name}@${entry.release.version}`;
  try {
    await deps.cache.delete(tier2CacheKey(entry.name, entry.release.version, 'objects'));
    await deps.cache.delete(tier2CacheKey(entry.name, entry.release.version, 'headers'));
  } catch (error) {
    throw new Error(`${resolved}: cache unavailable (${cacheDetail(error)}), reinstall aborted`);
  }
  return buildIndexObjects(entry, deps);
}

/**
 * Rebuilds the session's installed-index map from the versioned object cache,
 * which outlives the session while the map itself does not. Declarations
 * persist with the project; after a reload this repopulates validation and
 * resolution without a reinstall. Entries with no pinned version, no cached
 * entry, or undecodable bytes are skipped — they stay grey with the
 * validation reason until installed.
 */
export async function restoreInstalledIndex(
  declarations: readonly { readonly name: string; readonly version?: string }[],
  cache: { get(key: string): Promise<Uint8Array | null> },
): Promise<Map<string, { version: string; headers: readonly string[] }>> {
  const restored = new Map<string, { version: string; headers: readonly string[] }>();
  for (const declaration of declarations) {
    if (declaration.version === undefined) continue;
    const [hitObjects, hitHeaders] = await Promise.all([
      cache.get(tier2CacheKey(declaration.name, declaration.version, 'objects')),
      cache.get(tier2CacheKey(declaration.name, declaration.version, 'headers')),
    ]);
    if (hitObjects === null || hitHeaders === null) continue;
    const objects = decodeTier2Map(hitObjects);
    const headers = decodeTier2Map(hitHeaders);
    if (objects === null || headers === null) continue;
    restored.set(declaration.name, { version: declaration.version, headers: [...headers.keys()] });
  }
  return restored;
}
