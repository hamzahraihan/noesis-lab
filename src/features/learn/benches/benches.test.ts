import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { EXAMPLE_CIRCUITS, STARTER_CIRCUITS } from './index';
import { circuitFileText } from '@/features/bench/utils/circuit-file';
import type { CircuitDocument } from '@/features/simulation';

/**
 * The bench presets are generated documents, so the thing to pin is that the
 * index and the files are the same set and the same bytes: a preset edited by
 * hand without updating the file (or the reverse) fails here rather than at a
 * learner's Run.
 */
const DIR = __dirname;

const docs = new Map<string, CircuitDocument>();
for (const [board, doc] of Object.entries(STARTER_CIRCUITS)) {
  docs.set(`starter-${board}`, doc);
}
for (const [id, byBoard] of Object.entries(EXAMPLE_CIRCUITS)) {
  for (const [board, doc] of Object.entries(byBoard)) {
    docs.set(`example-${id}-${board}`, doc);
  }
}

const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .sort();

describe('bench preset documents', () => {
  it('are the same set in the directory and the index', () => {
    expect(files).toEqual([...docs.keys()].sort());
  });

  it('are the canonical text of the document the index parses', () => {
    for (const name of files) {
      const doc = docs.get(name);
      expect(doc, name).toBeDefined();
      expect(readFileSync(`${DIR}/${name}.json`, 'utf8'), name).toBe(circuitFileText(doc!));
    }
  });
});
