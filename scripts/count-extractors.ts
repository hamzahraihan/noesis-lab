import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Returns count from generated gallery-projects.json
export function getGalleryProjectCount(): number {
  const source = JSON.parse(readFileSync(join(ROOT, 'src/features/learn/gallery-projects.json'), 'utf-8'));
  return source.projects.length;
}

// Returns count from generated circuits-registry.ts - parse the file directly
export function getCircuitCount(): number {
  const content = readFileSync(join(ROOT, 'src/features/learn/generated/circuits-registry.ts'), 'utf-8');
  // Count the number of circuit entries in the CIRCUITS object
  const matches = content.match(/export const CIRCUITS:.*?= \{([\s\S]*?)\n\};/);
  if (!matches) return 0;
  const entries = matches[1].match(/['"][^'"]+['"]: parseCircuit/g);
  return entries ? entries.length : 0;
}

// Parses catalog.ts for ComponentSpec union members
export function getComponentKindsCount(): number {
  const content = readFileSync(join(ROOT, 'src/features/parts/catalog.ts'), 'utf-8');
  // Match: kind: 'kind-name' in the union
  const matches = content.matchAll(/kind:\s*'([a-z0-9-]+)'/g);
  return new Set([...matches].map(m => m[1])).size;
}

// Returns board count by parsing boardRegistry.ts
export function getBoardCount(): number {
  const content = readFileSync(join(ROOT, 'src/features/learn/boardRegistry.ts'), 'utf-8');
  // Match: export const BOARDS: ReadonlyArray<BoardOption> = [ ... ];
  const match = content.match(/export const BOARDS\s*:\s*ReadonlyArray<BoardOption>\s*=\s*\[([\s\S]*?)\];/);
  if (!match) return 0;
  // Count objects with id property
  const ids = match[1].match(/id:\s*['"][^'"]+['"]/g);
  return ids ? ids.length : 0;
}

// Returns exercise count by parsing exercise module files
export function getExerciseCount(): number {
  let total = 0;
  const modules = [
    'module-1-gpio.ts',
    'module-2-analog.ts',
    'module-3-bus-protocols.ts',
    'module-4-interrupts.ts',
    'module-5-maps.ts',
    'module-5-single-board-computers.ts',
    'module-5-networks.ts',
  ];
  for (const mod of modules) {
    const content = readFileSync(join(ROOT, 'src/features/learn/exercises', mod), 'utf-8');
    // Count exercise objects: const NAME: Exercise = { id: '...', ...
    const matches = content.match(/const\s+[A-Z_]+:\s*Exercise\s*=\s*\{/g);
    if (matches) total += matches.length;
  }
  return total;
}

// Parses parser.ts for supported features
export function getInterpreterCapabilities(): string[] {
  const content = readFileSync(join(ROOT, 'src/features/simulation/firmware/parser.ts'), 'utf-8');
  const capabilities: string[] = [];
  if (content.includes('class ')) capabilities.push('classes');
  if (content.includes('String')) capabilities.push('String');
  if (content.includes('uint8_t') || content.includes('int8_t')) capabilities.push('fixed-width integers');
  // Check for absent features
  // pointers, structs, heap allocation, templates are not supported
  return capabilities;
}