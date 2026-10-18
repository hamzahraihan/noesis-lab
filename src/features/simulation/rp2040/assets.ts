import uf2Url from './firmware/RPI_PICO-20260824-v1.29.0.uf2?url';
import littlefsWasmUrl from 'littlefs/dist/littlefs.wasm?url';

/** Bytes the engine boots from: the pinned firmware and the filesystem wasm. */
export interface Rp2040Assets {
  /** Raw .uf2 file bytes, exactly as committed (validated by the manifest guard). */
  readonly uf2: ArrayBuffer;
  /** littlefs wasm binary; `buildLittlefsImage` instantiates it per build. */
  readonly littlefsWasm: ArrayBuffer;
}

export type AssetFetch = (url: string) => Promise<ArrayBuffer>;

/**
 * Asset URLs as emitted by the bundler. Exported so tests can name the files
 * they fetch without hard-coding hashed paths.
 */
export const RP2040_UF2_URL: string = uf2Url;
export const RP2040_LITTLEFS_WASM_URL: string = littlefsWasmUrl;

async function httpBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetching ${url} failed: HTTP ${response.status}`);
  return response.arrayBuffer();
}

async function fetchPair(fetchBytes: AssetFetch): Promise<Rp2040Assets> {
  const [uf2, littlefsWasm] = await Promise.all([
    fetchBytes(RP2040_UF2_URL),
    fetchBytes(RP2040_LITTLEFS_WASM_URL),
  ]);
  return { uf2, littlefsWasm };
}

/**
 * The pinned artifacts, fetched once per session by the default transport.
 *
 * Both files are immutable — the UF2 is committed and manifest-guarded, the
 * littlefs wasm ships with the package — so every Run (and Reset) re-using the
 * same bytes is the point: a rebuild would otherwise cost ~700 kB of HTTP and
 * a fresh instantiation per press. A failed fetch is *not* cached, so a retry
 * after a network blip still works. Tests pass their own `fetchBytes` and see
 * no cache.
 */
let defaults: Promise<Rp2040Assets> | null = null;

export function fetchRp2040Assets(fetchBytes: AssetFetch = httpBytes): Promise<Rp2040Assets> {
  if (fetchBytes !== httpBytes) return fetchPair(fetchBytes);
  defaults ??= fetchPair(httpBytes).catch((error: unknown) => {
    defaults = null;
    throw error;
  });
  return defaults;
}
