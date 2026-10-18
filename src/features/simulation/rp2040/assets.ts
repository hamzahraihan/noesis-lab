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

/**
 * Fetches both engine artifacts together. The default transport is HTTP; the
 * worker passes nothing and tests inject bytes from disk.
 */
export async function fetchRp2040Assets(fetchBytes: AssetFetch = httpBytes): Promise<Rp2040Assets> {
  const [uf2, littlefsWasm] = await Promise.all([
    fetchBytes(RP2040_UF2_URL),
    fetchBytes(RP2040_LITTLEFS_WASM_URL),
  ]);
  return { uf2, littlefsWasm };
}
