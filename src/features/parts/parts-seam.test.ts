/**
 * Seam-order regression probe (Task 4b).
 *
 * Imports the parts seam FIRST and the simulation seam second, then asserts
 * every catalogue entry's factory returns a real definition. A parts↔sim
 * module-evaluation cycle would surface here as uninitialized bindings
 * (`make` undefined or returning undefined). The opposite order (simulation
 * first) is covered by the existing ui simulation tests.
 */
import { describe, expect, it } from 'vitest';
import { PART_CATALOGUE } from '@/features/parts';
import { Engine } from '@/features/simulation';

describe('parts seam integrity', () => {
  it('every catalogue entry makes a definition', () => {
    expect(Engine).toBeDefined();
    expect(PART_CATALOGUE.length).toBeGreaterThan(0);
    for (const entry of PART_CATALOGUE) {
      expect(typeof entry.make).toBe('function');
      const definition = entry.make();
      expect(definition).toBeDefined();
      expect(typeof definition.name).toBe('string');
    }
  });
});
