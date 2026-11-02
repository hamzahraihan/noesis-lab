import { readdirSync, readFileSync } from 'fs';
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

// Returns exercise count by walking the exercise declarations.
//
// The authoritative list is `EXERCISES` in `exercises.ts`, which spreads the
// per-module arrays and adds the Module 0 opener. Counting declarations in the
// module folder alone misses that opener, so this walks the folder plus
// `exercises.ts` itself rather than checking in a hand-maintained module list.
export function getExerciseCount(): number {
  const exercisesDir = join(ROOT, 'src/features/learn/exercises');
  const files = [
    ...readdirSync(exercisesDir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(exercisesDir, name)),
    join(ROOT, 'src/features/learn/exercises.ts'),
  ];
  let total = 0;
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    // Count exercise objects: const NAME: Exercise = { id: '...', ...
    const matches = content.match(/const\s+[A-Z0-9_]+:\s*Exercise\s*=\s*\{/g);
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