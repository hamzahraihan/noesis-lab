import { formatLittlefsImage, type ImageFile } from '../littlefs-image';

export type { ImageFile };

/**
 * The ESP32's filesystem, as the MicroPython port lays it out.
 *
 * The ESP32 port mounts a littlefs volume from a partition of the flash, and
 * the official ESP32_GENERIC image gives it a 2 MiB partition of 4096-byte
 * blocks. The volume is formatted with the same littlefs the RP2 port uses,
 * so a sketch written for one board is a sketch for the other: the files are
 * plain Python, and `main.py` at the root is what the chip runs.
 */
export const ESP32_BLOCK_SIZE = 4096;
export const ESP32_BLOCK_COUNT = 512;

/**
 * Where the volume lives in the flash.
 *
 * The partition table in the official image puts it here, and the emulator
 * writes the image into the same place, so the chip mounts what the host
 * built.
 */
export const ESP32_FILESYSTEM_OFFSET = 0x200000;

/**
 * Format the filesystem image the emulated chip mounts.
 *
 * The image is a plain Uint8Array, ready to be written into the flash at
 * `ESP32_FILESYSTEM_OFFSET`. Throws when littlefs reports a failure -- the
 * caller never receives a silently broken image.
 */
export async function buildEsp32Filesystem(
  files: readonly ImageFile[],
  wasmBinary: ArrayBuffer | Uint8Array,
): Promise<Uint8Array> {
  return formatLittlefsImage(files, wasmBinary, {
    blockSize: ESP32_BLOCK_SIZE,
    blockCount: ESP32_BLOCK_COUNT,
  });
}
