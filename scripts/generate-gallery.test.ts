import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAll } from './generate-gallery';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = JSON.parse(
  readFileSync(join(__dirname, '..', 'src', 'features', 'learn', 'gallery-projects.json'), 'utf-8'),
);

describe('generate-gallery', () => {
  it('produces non-empty output for all generators', () => {
    const outputs = generateAll(SOURCE);
    expect(String(outputs.galleryProjects)).toContain('export const GALLERY');
    expect(String(outputs.circuitsRegistry)).toContain('export const CIRCUITS');
    expect(String(outputs.checksMap)).toContain('export const CHECKS_MAP');
    expect(String(outputs.testCoverage)).toContain('export const GALLERY_PROJECT_IDS');
  });

  it('includes every project in CHECKS_MAP', () => {
    const outputs = generateAll(SOURCE);
    for (const project of SOURCE.projects) {
      expect(outputs.checksMap).toHaveProperty(project.id);
    }
  });

  it('CIRCUITS registry has entry for every unique circuit', () => {
    const outputs = generateAll(SOURCE);
    const circuits = new Set(SOURCE.projects.flatMap((p: any) => p.builds.map((b: any) => b.circuit)));
    for (const c of circuits) {
      expect(outputs.circuitsRegistry).toHaveProperty((c as string).replace('.json', ''));
    }
  });

  it('works with no source argument (defaults to project source)', () => {
    const outputs = generateAll();
    expect(String(outputs.checksMap)).toContain('CHECKS_MAP');
  });
});