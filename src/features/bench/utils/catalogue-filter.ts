// Shared catalogue matching for the sidebar search and the full grid.
//
// `PartSearch` and `CatalogueGrid` each spelled the same needle + name/note/id
// filter inline. One pure helper collapses both call sites to a single line
// each, so the two views cannot drift apart about what "search" means.
import { PART_CATALOGUE, type CatalogueEntry } from '@/features/parts';

export function matchCatalogue(query: string, group = 'all'): CatalogueEntry[] {
  const needle = query.trim().toLowerCase();
  return PART_CATALOGUE.filter((entry) => {
    if (group !== 'all' && entry.group !== group) return false;
    if (!needle) return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.note.toLowerCase().includes(needle) ||
      entry.id.toLowerCase().includes(needle)
    );
  });
}
