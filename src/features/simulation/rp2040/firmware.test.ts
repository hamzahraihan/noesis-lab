import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FIRMWARE = 'src/features/simulation/rp2040/firmware/RPI_PICO-20260824-v1.29.0.uf2';
const MANIFEST = 'src/features/simulation/rp2040/firmware/manifest.json';

describe('pinned MicroPython firmware', () => {
  it('matches the manifest hash and size', () => {
    const { sha256, bytes } = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
      sha256: string;
      bytes: number;
    };
    const file = readFileSync(FIRMWARE);
    expect(file.length).toBe(bytes);
    expect(createHash('sha256').update(file).digest('hex')).toBe(sha256);
  });
});
