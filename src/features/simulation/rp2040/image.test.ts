import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { LITTLEFS_BLOCK_COUNT, LITTLEFS_BLOCK_SIZE } from './backend';
import { buildLittlefsImage } from './image';

const require = createRequire(import.meta.url);
const wasmBinary = readFileSync(require.resolve('littlefs/dist/littlefs.wasm'));

describe('littlefs image builder', () => {
  it('formats a 352-block image carrying the given files', async () => {
    const image = await buildLittlefsImage(
      [
        { name: 'main.py', content: 'print("hello")\n' },
        { name: 'helper.py', content: 'TAG = "MOUNTED"\n' },
      ],
      wasmBinary,
    );
    expect(image.length).toBe(LITTLEFS_BLOCK_COUNT * LITTLEFS_BLOCK_SIZE);
    expect(image.some((byte) => byte !== 0xff)).toBe(true);
    // LittleFS stores file names as plain bytes in its metadata; the full
    // mount proof is the blink leg, which runs main.py out of this image.
    const latin = Buffer.from(image).toString('latin1');
    expect(latin).toContain('main.py');
    expect(latin).toContain('helper.py');
  }, 60000);
});
