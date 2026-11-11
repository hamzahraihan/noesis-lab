#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { 
  getGalleryProjectCount,
  getCircuitCount,
  getComponentKindsCount,
  getBoardCount,
  getExerciseCount,
  getInterpreterCapabilities
} from './count-extractors';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function updatePlaceholders(content: string, counts: Record<string, string | number>): string {
  let result = content;
  for (const [key, value] of Object.entries(counts)) {
    const placeholder = `<!-- COUNT:${key} -->`;
    result = result.replace(new RegExp(placeholder, 'g'), String(value));
  }
  return result;
}

async function main() {
  const counts = {
    GALLERY_PROJECTS: getGalleryProjectCount(),
    CIRCUITS: getCircuitCount(),
    COMPONENT_KINDS: getComponentKindsCount(),
    BOARDS: getBoardCount(),
    EXERCISES: getExerciseCount(),
    INTERPRETER_CAPABILITIES: getInterpreterCapabilities().join(', '),
  };

  // Update parity-scorecard.md
  const parityPath = join(ROOT, 'docs/parity-scorecard.md');
  let parity = readFileSync(parityPath, 'utf-8');
  parity = updatePlaceholders(parity, counts);
  writeFileSync(parityPath, parity);

  // Update PLAN.md
  const planPath = join(ROOT, 'docs/PLAN.md');
  let plan = readFileSync(planPath, 'utf-8');
  plan = updatePlaceholders(plan, counts);
  writeFileSync(planPath, plan);

  // PRODUCT.md carries the same placeholders, so it drifts the same way.
  const productPath = join(ROOT, 'PRODUCT.md');
  let product = readFileSync(productPath, 'utf-8');
  product = updatePlaceholders(product, counts);
  writeFileSync(productPath, product);

  console.log('Updated docs counts:', counts);
}

main();