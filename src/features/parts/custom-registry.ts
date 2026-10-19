/**
 * The seam between the catalogue and the custom parts a session has imported.
 *
 * `partDefinitionById` is the one resolver the whole app goes through, and the
 * catalogue cannot import the store that answers for imported parts without a
 * cycle (`custom.ts` derives its rules *from* the catalogue). So the store
 * registers itself here and the catalogue asks this module, which knows nothing
 * about either of them.
 *
 * Nothing registered means the bench is exactly what it was: shipped parts only.
 */

import type { PartDefinition } from './catalog';

export interface CustomPartsSource {
  /** The imported definition for an id, or null. */
  definition(id: string): PartDefinition | null;
  /** Whether an imported part is one the bench lays out as a large part. */
  isLarge(id: string): boolean;
}

let source: CustomPartsSource | null = null;

/** Registers the custom parts, replacing any previous source. Null clears them. */
export function setCustomPartsSource(next: CustomPartsSource | null): void {
  source = next;
}

export function customPartsSource(): CustomPartsSource | null {
  return source;
}
