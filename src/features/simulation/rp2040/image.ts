import littlefs from 'littlefs';
import { LITTLEFS_BLOCK_COUNT, LITTLEFS_BLOCK_SIZE } from './backend';

/** One file to seat in the image, at the filesystem root. */
export interface ImageFile {
  readonly name: string;
  readonly content: string;
}

/**
 * The slice of the littlefs wasm module this builder uses. The package ships
 * no types for its internals, so each shape below is pinned to what the
 * reconnaissance build produced.
 */
interface LittlefsWasm {
  HEAPU8: Uint8Array;
  addFunction(callback: (...args: number[]) => void, signature: string): number;
  cwrap(name: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => number;
  _new_lfs_config(
    read: number,
    prog: number,
    erase: number,
    sync: number,
    blockCount: number,
    blockSize: number,
  ): number;
  _new_lfs(): number;
  _lfs_format(lfs: number, config: number): number;
  _lfs_mount(lfs: number, config: number): number;
  _lfs_unmount(lfs: number): number;
  _free(pointer: number): void;
}

/**
 * Format a LittleFS image carrying `files` at its root. The image is a plain
 * Uint8Array so the caller can drop it straight into flash.
 *
 * Throws when littlefs reports a failure — callers never receive a silently
 * broken image.
 *
 * `wasmBinary` is passed explicitly to keep this module context-free: Node
 * tests hand over bytes read from disk, and the worker will later hand over a
 * fetched asset.
 */
export async function buildLittlefsImage(
  files: readonly ImageFile[],
  wasmBinary: ArrayBuffer | Uint8Array,
): Promise<Uint8Array> {
  const image = new Uint8Array(LITTLEFS_BLOCK_SIZE * LITTLEFS_BLOCK_COUNT);
  image.fill(0xff);
  const module = (await littlefs({ wasmBinary })) as LittlefsWasm;
  const heap = module.HEAPU8;

  // littlefs drives storage through these callbacks; each moves the raw
  // (config, block, offset, buffer, size) window it was given.
  const read = module.addFunction(
    (_config: number, block: number, offset: number, buffer: number, size: number) => {
      const start = block * LITTLEFS_BLOCK_SIZE + offset;
      heap.set(image.subarray(start, start + size), buffer);
    },
    'iiiiii',
  );
  const program = module.addFunction(
    (_config: number, block: number, offset: number, buffer: number, size: number) => {
      const start = block * LITTLEFS_BLOCK_SIZE + offset;
      image.set(heap.subarray(buffer, buffer + size), start);
    },
    'iiiiii',
  );
  const erase = module.addFunction((_config: number, block: number) => {
    image.fill(0xff, block * LITTLEFS_BLOCK_SIZE, (block + 1) * LITTLEFS_BLOCK_SIZE);
  }, 'iii');
  const sync = module.addFunction(() => {}, 'ii');

  const config = module._new_lfs_config(
    read,
    program,
    erase,
    sync,
    LITTLEFS_BLOCK_COUNT,
    LITTLEFS_BLOCK_SIZE,
  );
  const lfs = module._new_lfs();
  const formatResult = module._lfs_format(lfs, config);
  if (formatResult !== 0) {
    throw new Error(`littlefs: lfs_format failed (${formatResult})`);
  }
  const mountResult = module._lfs_mount(lfs, config);
  if (mountResult !== 0) {
    throw new Error(`littlefs: lfs_mount failed (${mountResult})`);
  }
  const writeFile = module.cwrap('lfs_write_file', 'number', ['number', 'string', 'string', 'number']);
  for (const file of files) {
    let result: number;
    try {
      result = writeFile(lfs, file.name, file.content, new TextEncoder().encode(file.content).length);
    } catch (cause) {
      // The wasm shim aborts the instance for some failures (e.g. an
      // over-long name trips a littlefs assertion) instead of returning an
      // error code, so both failure shapes get a label here.
      throw new Error(`littlefs: lfs_write_file failed for ${file.name}: ${String(cause)}`);
    }
    // Negative results are littlefs error codes (LFS_ERR_*); 0 is success.
    if (result < 0) {
      throw new Error(`littlefs: lfs_write_file failed for ${file.name} (${result})`);
    }
  }
  module._lfs_unmount(lfs);
  module._free(lfs);
  module._free(config);
  return image;
}
