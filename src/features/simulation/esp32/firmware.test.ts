import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'src/features/simulation/esp32/firmware';
const MANIFEST = `${DIR}/manifest.json`;

interface ManifestEntry {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly license: string;
}

interface Manifest {
  readonly artifacts: readonly ManifestEntry[];
}

describe('the pinned ESP32 artefacts', () => {
  it('match the manifest hash and size', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
    expect(manifest.artifacts.length).toBeGreaterThan(0);

    for (const artifact of manifest.artifacts) {
      const file = readFileSync(`${DIR}/${artifact.file}`);
      expect(file.length, artifact.file).toBe(artifact.bytes);
      expect(createHash('sha256').update(file).digest('hex'), artifact.file).toBe(artifact.sha256);
    }
  });

  it('name a licence for every artefact', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
    for (const artifact of manifest.artifacts) {
      expect(artifact.license, artifact.file).toMatch(/^(MIT|Apache-2\.0)$/);
    }
  });
});
