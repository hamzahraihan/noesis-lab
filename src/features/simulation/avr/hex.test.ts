import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { buildFor, galleryById } from '@/features/learn/gallery';

const HEX = join(__dirname, 'hex', 'alarm-clock-uno.hex');
const MANIFEST = join(__dirname, 'hex', 'manifest.json');

function sourcesHash(): string {
  const build = galleryById('alarm-clock')!.builds[0];
  const parts = [build.sketch, ...(build.files ?? []).map((f) => `${f.name}\n${f.content}`)];
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

describe('avr hex assets', () => {
  it('ships a manifest whose hashes match the files and the sketch sources', () => {
    if (!existsSync(HEX) || !existsSync(MANIFEST)) {
      console.warn('SKIP: HEX assets absent (build with scripts/build-avr-hex.mjs)');
      return;
    }
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
      file: string;
      sha256: string;
      sourcesHash: string;
    };
    const bytes = readFileSync(HEX);
    expect(manifest.file).toBe('alarm-clock-uno.hex');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    expect(manifest.sourcesHash).toBe(sourcesHash());
    expect(bytes.length).toBeGreaterThan(1024);
  });
  it('ships a matching manifest for the library build HEX', () => {
    const libHex = join(__dirname, 'hex', 'alarm-clock-lib-uno.hex');
    const libManifest = join(__dirname, 'hex', 'alarm-clock-lib-manifest.json');
    if (!existsSync(libHex) || !existsSync(libManifest)) {
      console.warn('SKIP: library HEX assets absent (build with scripts/build-avr-hex.mjs --variant=library)');
      return;
    }
    const build = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    const parts = [build.sketch, ...(build.files ?? []).map((f) => `${f.name}\n${f.content}`)];
    const manifest = JSON.parse(readFileSync(libManifest, 'utf8')) as { file: string; sha256: string; sourcesHash: string };
    const bytes = readFileSync(libHex);
    expect(manifest.file).toBe('alarm-clock-lib-uno.hex');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    expect(manifest.sourcesHash).toBe(createHash('sha256').update(parts.join('\n')).digest('hex'));
    expect(bytes.length).toBeGreaterThan(1024);
  });
});
