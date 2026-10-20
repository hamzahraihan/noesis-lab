import { formatLittlefsImage, type ImageFile } from '../littlefs-image';
import { LITTLEFS_BLOCK_COUNT, LITTLEFS_BLOCK_SIZE } from './backend';

export type { ImageFile };

/**
 * Format a LittleFS image carrying `files` at its root, in the geometry the
 * MicroPython RP2 port expects: 352 blocks of 4096 bytes, which is the tail
 * of the Pico's 2 MiB flash.
 *
 * The image is a plain Uint8Array so the caller can drop it straight into
 * flash. Throws when littlefs reports a failure -- callers never receive a
 * silently broken image.
 */
export async function buildLittlefsImage(
  files: readonly ImageFile[],
  wasmBinary: ArrayBuffer | Uint8Array,
): Promise<Uint8Array> {
  return formatLittlefsImage(files, wasmBinary, {
    blockSize: LITTLEFS_BLOCK_SIZE,
    blockCount: LITTLEFS_BLOCK_COUNT,
  });
}
