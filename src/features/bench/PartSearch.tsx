/**
 * Search over the whole catalogue, on the sidebar.
 *
 * The quick-parts list answers "I want the usual resistor". This answers "I
 * want a 470 uF cap" without first working out which menu it hides in. With
 * nothing typed it shows the quick list, so the sidebar stays useful when the
 * search box is idle, and every result carries the real footprint so what is
 * picked is what lands on the bench.
 */

import { useMemo, useState } from 'react';
import {
  Cross2Icon,
  MagnifyingGlassIcon,
  ReaderIcon,
} from '@radix-ui/react-icons';
import { PART_CATALOGUE, type CatalogueEntry } from '@/features/parts';
import type { PartDefinition } from '@/features/parts';
import { Button, Input } from '@/components';
import { PartPreview } from './PartPreview';
import { matchCatalogue } from './utils/catalogue-filter';

/**
 * The parts you reach for every time.
 *
 * Deliberately short. The browser behind the header button has everything, and
 * a sidebar that listed all of it would just be a narrower version of the same
 * list.
 */
const QUICK_PARTS: readonly string[] = [
  'resistor-220',
  'resistor-10000',
  'led-red',
  'led-green',
  'potentiometer-10000',
  'button-tactile',
];

export function PartSearch({
  onPlace,
  onBrowse,
}: {
  onPlace: (definition: PartDefinition, entry: CatalogueEntry) => void;
  onBrowse(): void;
}) {
  const [query, setQuery] = useState('');

  const { results, searching } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return {
        searching: false,
        results: QUICK_PARTS.map((id) => PART_CATALOGUE.find((entry) => entry.id === id)).filter(
          (entry): entry is CatalogueEntry => entry !== undefined,
        ),
      };
    }
    return { searching: true, results: matchCatalogue(query) };
  }, [query]);
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-3 pb-2">
        <label className="relative block">
          <span className="sr-only">Search components</span>
          {/*
           * The glyph rides inside the field, so the placeholder keeps the
           * full width instead of starting behind a magnifier.
           */}
          <MagnifyingGlassIcon
            className="icon-sm pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-slate-600"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search parts…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search components"
            className="pr-7 pl-7"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <Cross2Icon className="icon-sm" aria-hidden="true" />
            </button>
          )}
        </label>
      </div>

      <h2 className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        {searching ? `${results.length} match${results.length === 1 ? '' : 'es'}` : 'Quick parts'}
      </h2>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {results.length === 0 ? (
          // A search that finds nothing should offer the way out, not just
          // report the absence.
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center text-xs text-slate-500">
            <p>No parts match “{query}”.</p>
            <Button variant="outline" size="sm" onClick={() => setQuery('')}>
              Clear search
            </Button>
          </div>
        ) : (
          results.map((entry) => (
            <SearchRow key={entry.id} entry={entry} onPlace={onPlace} showNote={searching} />
          ))
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onBrowse}
        className="mx-2 mb-3 shrink-0"
      >
        <ReaderIcon className="icon" aria-hidden="true" />
        Browse all components
      </Button>
    </section>
  );
}

function SearchRow({
  entry,
  onPlace,
  showNote,
}: {
  entry: CatalogueEntry;
  onPlace: (definition: PartDefinition, entry: CatalogueEntry) => void;
  showNote: boolean;
}) {
  const definition = useMemo(() => entry.make(), [entry]);

  return (
    <button
      type="button"
      onClick={() => onPlace(definition, entry)}
      title={entry.note}
      className="mx-2 flex w-[calc(100%-1rem)] items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-700"
    >
      <PartPreview definition={definition} className="mt-0.5 h-7 w-9 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-slate-200">{entry.name}</span>
        {showNote && (
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{entry.note}</span>
        )}
      </span>
    </button>
  );
}