import { mkdirSync, writeFileSync } from 'node:fs';
import { buildFor, galleryById } from '../src/features/learn/gallery';

const variant = process.argv[2] === 'library' ? 'library' : undefined;
const build = buildFor(galleryById('alarm-clock')!, 'uno', variant)!;
mkdirSync('.avr-stage', { recursive: true });
writeFileSync(
  '.avr-stage/sources.json',
  JSON.stringify({ sketch: build.sketch, files: build.files ?? [] }),
);
