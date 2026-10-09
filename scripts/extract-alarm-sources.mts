import { mkdirSync, writeFileSync } from 'node:fs';
import { galleryById } from '../src/features/learn/gallery';

const build = galleryById('alarm-clock')!.builds[0]!;
mkdirSync('.avr-stage', { recursive: true });
writeFileSync('.avr-stage/sources.json', JSON.stringify({ sketch: build.sketch, files: build.files ?? [] }));
