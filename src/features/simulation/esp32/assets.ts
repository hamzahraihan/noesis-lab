import imageUrl from './firmware/ESP32_GENERIC-20260824-v1.29.0.bin?url';
import romUrl from './firmware/esp32_rev300_rom.elf?url';
import wasmUrl from './firmware/esp32sim.wasm?url';
import littlefsWasmUrl from 'littlefs/dist/littlefs.wasm?url';

/** Bytes the engine boots from: the emulator, the mask ROM and the image. */
export interface Esp32Assets {
  /** The emulator's WebAssembly module, exactly as committed. */
  readonly wasm: ArrayBuffer;
  /** The chip's mask ROM, as the ELF the ROM boot expects. */
  readonly rom: ArrayBuffer;
  /** The application image the ROM boots into. */
  readonly image: ArrayBuffer;
  /** littlefs wasm binary; the filesystem image is built with it. */
  readonly littlefsWasm: ArrayBuffer;
}

export type AssetFetch = (url: string) => Promise<ArrayBuffer>;

/**
 * Asset URLs as emitted by the bundler. Exported so tests can name the files
 * they fetch without hard-coding hashed paths.
 */
export const ESP32_WASM_URL: string = wasmUrl;
export const ESP32_ROM_URL: string = romUrl;
export const ESP32_IMAGE_URL: string = imageUrl;
export const ESP32_LITTLEFS_WASM_URL: string = littlefsWasmUrl;

async function httpBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetching ${url} failed: HTTP ${response.status}`);
  return response.arrayBuffer();
}

async function fetchAll(fetchBytes: AssetFetch): Promise<Esp32Assets> {
  const [wasm, rom, image, littlefsWasm] = await Promise.all([
    fetchBytes(ESP32_WASM_URL),
    fetchBytes(ESP32_ROM_URL),
    fetchBytes(ESP32_IMAGE_URL),
    fetchBytes(ESP32_LITTLEFS_WASM_URL),
  ]);
  return { wasm, rom, image, littlefsWasm };
}

/**
 * The pinned artifacts, fetched once per session by the default transport.
 *
 * All four files are immutable -- they are committed and manifest-guarded --
 * so every Run (and Reset) re-using the same bytes is the point: a rebuild
 * would otherwise cost 5 MB of HTTP and a fresh instantiation per press. A
 * failed fetch is *not* cached, so a retry after a network blip still works.
 * Tests pass their own `fetchBytes` and see no cache.
 */
let defaults: Promise<Esp32Assets> | null = null;

export function fetchEsp32Assets(fetchBytes: AssetFetch = httpBytes): Promise<Esp32Assets> {
  if (fetchBytes !== httpBytes) return fetchAll(fetchBytes);
  defaults ??= fetchAll(httpBytes).catch((error: unknown) => {
    defaults = null;
    throw error;
  });
  return defaults;
}
