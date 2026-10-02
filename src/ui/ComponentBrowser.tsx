/**
 * The component browser: every part the bench can hold, in one place.
 *
 * The palette down the side is for the parts you reach for every time; this is
 * for the moment when you know what you need but cannot remember whether it was
 * the 10 k pot or the 100 k one. Every card renders the real footprint rather
 * than a stand-in, so the thing you pick is the thing that appears on the bench.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATALOGUE_GROUPS,
  PART_CATALOGUE,
  type CatalogueEntry,
} from '../sim/catalogue';
import type { PartDefinition } from '../sim/catalog';
import { PartPreview } from './PartPreview';

export interface ComponentBrowserProps {
  readonly onPlace: (definition: PartDefinition, entry: CatalogueEntry) => void;
  readonly onClose: () => void;
}

export function ComponentBrowser({ onPlace, onClose }: ComponentBrowserProps) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matches = useMemo(() => {
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
  }, [query, group]);

  /** Keeps every group that still has a match, in catalogue order. */
  const sections = useMemo(
    () =>
      CATALOGUE_GROUPS.map((heading) => ({
        ...heading,
        entries: matches.filter((entry) => entry.group === heading.id),
      })).filter((section) => section.entries.length > 0),
    [matches],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Component browser"
        className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Components</h2>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or by what it is for..."
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-500"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            Esc to close
          </button>
        </header>

        <nav className="flex shrink-0 gap-1.5 border-b border-slate-800 px-4 py-2">
          {[{ id: 'all', label: 'All' }, ...CATALOGUE_GROUPS].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setGroup(option.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                group === option.id
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {sections.length === 0 && (
            <p className="py-12 text-center text-sm text-slate-500">Nothing matches that.</p>
          )}
          {sections.map((section) => (
            <section key={section.id} className="mb-6 last:mb-0">
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                {section.label}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {section.entries.map((entry) => (
                  <CatalogueCard key={entry.id} entry={entry} onPlace={onPlace} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function CatalogueCard({
  entry,
  onPlace,
}: {
  entry: CatalogueEntry;
  onPlace: (definition: PartDefinition, entry: CatalogueEntry) => void;
}) {
  // Built once per entry, so the card shows the same part the bench will get
  // rather than a fresh instance rebuilt on every re-render.
  const definition = useMemo(() => entry.make(), [entry]);

  return (
    <button
      type="button"
      onClick={() => onPlace(definition, entry)}
      className="group flex flex-col rounded-lg border border-slate-800 bg-slate-950 p-3 text-left transition-colors hover:border-sky-600 hover:bg-slate-900"
    >
      <div className="mb-2 flex h-20 items-center justify-center rounded bg-slate-900/60 p-2">
        <PartPreview definition={definition} className="h-full w-full" />
      </div>
      <span className="text-sm font-medium text-slate-100 group-hover:text-sky-300">
        {entry.name}
      </span>
      <span className="mt-0.5 text-xs leading-snug text-slate-500">{entry.note}</span>
      <span className="mt-2 text-[10px] tracking-wide text-slate-600 uppercase">
        {definition.pins.length} pins · {definition.widthMm.toFixed(0)}×
        {definition.heightMm.toFixed(0)} mm
      </span>
    </button>
  );
}
