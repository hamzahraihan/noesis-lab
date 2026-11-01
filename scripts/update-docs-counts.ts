#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export function getGalleryProjectCount(): number {
  const source = JSON.parse(readFileSync(join(ROOT, 'src/features/learn/gallery-projects.json'), 'utf-8')) as {
    projects: unknown[];
  };
  return source.projects.length;
}

export function getCircuitCount(): number {
  return readdirSync(join(ROOT, 'src/features/learn/circuits')).filter((name) =>
    name.endsWith('.json'),
  ).length;
}

export function getComponentKindsCount(): number {
  const content = readFileSync(join(ROOT, 'src/features/parts/catalog.ts'), 'utf-8');
  const matches = content.matchAll(/kind:\s*'([a-z0-9-]+)'/g);
  return new Set(Array.from(matches, (match) => match[1])).size;
}

export function getBoardCount(): number {
  const content = readFileSync(join(ROOT, 'src/features/learn/boardRegistry.ts'), 'utf-8');
  const matches = content.matchAll(/id:\s*'([a-z0-9-]+)'/g);
  return Array.from(matches).length;
}

export function getExerciseCount(): number {
  const ids = new Set<string>();
  const files = [join(ROOT, 'src/features/learn/exercises.ts')];
  const dir = join(ROOT, 'src/features/learn/exercises');
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.ts')) files.push(join(dir, name));
  }
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    for (const match of content.matchAll(/id:\s*'(\d+\.\d+)'/g)) {
      ids.add(match[1]);
    }
  }
  return ids.size;
}

export function getInterpreterCapabilities(): string[] {
  const content = readFileSync(join(ROOT, 'src/features/simulation/firmware/parser.ts'), 'utf-8');
  const capabilities: string[] = [];
  if (content.includes('class ')) capabilities.push('classes');
  if (content.includes('String')) capabilities.push('String');
  if (content.includes('uint8_t') || content.includes('int8_t')) capabilities.push('fixed-width integers');
  return capabilities;
}

const COUNTS: Record<string, number | string> = {};

async function main(): Promise<void> {
  const counts: Record<string, number | string> = {
    GALLERY_PROJECTS: getGalleryProjectCount(),
    CIRCUITS: getCircuitCount(),
    COMPONENT_KINDS: getComponentKindsCount(),
    BOARDS: getBoardCount(),
    EXERCISES: getExerciseCount(),
    INTERPRETER_CAPABILITIES: getInterpreterCapabilities().join(', '),
  };

  const files = [join(ROOT, 'docs/parity-scorecard.md'), join(ROOT, 'docs/PLAN.md')];
  for (const file of files) {
    let content = readFileSync(file, 'utf-8');
    for (const [key, value] of Object.entries(counts)) {
      const placeholder = `<!-- COUNT:${key} -->`;
      content = content.split(placeholder).join(String(value));
    }
    writeFileSync(file, content, 'utf-8');
  }

  console.log('Updated docs counts:', counts);
}

main();