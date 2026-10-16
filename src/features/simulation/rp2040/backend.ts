/**
 * Shared geometry for the RP2040 engine. The firmware image occupies the
 * front of the Pico's 2 MiB flash; LittleFS starts at 0xa0000, and 352 blocks
 * of 4096 bytes fill the rest exactly.
 */

export const LITTLEFS_BLOCK_COUNT = 352;
export const LITTLEFS_BLOCK_SIZE = 4096;
