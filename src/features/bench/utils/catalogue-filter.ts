// Shared catalogue matching for the sidebar search and the full grid.
//
// `PartSearch` and `CatalogueGrid` each spelled the same needle + name/note/id
// filter inline. One pure helper collapses both call sites to a single line
// each, so the two views cannot drift apart about what "search" means.
import { PART_CATALOGUE, type CatalogueEntry } from '@/features/parts';

/**
 * Whether an entry answers to what the operator typed.
 *
 * Exported because imported parts (`custom-store.ts`) are searched by the same
 * rule as shipped ones, and two copies of "what search means" is how the two
 * views stop agreeing.
 */
export function matchesCatalogueQuery(entry: CatalogueEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.note.toLowerCase().includes(needle) ||
    entry.id.toLowerCase().includes(needle)
  );
}

export function matchCatalogue(query: string, group = 'all'): CatalogueEntry[] {
  return PART_CATALOGUE.filter(
    (entry) => (group === 'all' || entry.group === group) && matchesCatalogueQuery(entry, query),
  );
}
