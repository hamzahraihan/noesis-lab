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
import { WokwiLibrary } from './WokwiLibrary';
import {
  Cross2Icon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@radix-ui/react-icons';

export interface ComponentBrowserProps {
  readonly onPlace: (definition: PartDefinition, entry: CatalogueEntry) => void;
  readonly onClose: () => void;
}

export function ComponentBrowser({ onPlace, onClose }: ComponentBrowserProps) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'catalogue' | 'library'>('catalogue');
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
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlassIcon
              className="icon-sm pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-600"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or by what it is for..."
              aria-label="Search components"
              className="w-full rounded-md border border-slate-700 bg-slate-950 py-1.5 pr-3 pl-8 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-500"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ctl ctl-quiet"
            title="Close (Esc)"
            aria-label="Close the component browser"
          >
            <Cross2Icon className="icon" aria-hidden="true" />
          </button>
        </header>

        <nav
          className="flex shrink-0 items-center gap-1.5 border-b border-slate-800 px-4 py-2"
          aria-label="Component categories"
        >
          {[{ id: 'all', label: 'All' }, ...CATALOGUE_GROUPS].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setView('catalogue');
                setGroup(option.id);
              }}
              aria-pressed={view === 'catalogue' && group === option.id}
              className={`ctl rounded-full ${
                view === 'catalogue' && group === option.id ? 'ctl-accent' : 'ctl-quiet'
              }`}
            >
              {option.label}
            </button>
          ))}
          {/*
           * The catalogue is what the bench can hold. This is the whole library
           * behind it -- the parts that are not placeable yet, and why -- so
           * "there is no servo here" has an answer you can look at.
           */}
          <button
            type="button"
            onClick={() => setView('library')}
            aria-pressed={view === 'library'}
            className={`ctl ml-auto rounded-full ${view === 'library' ? 'ctl-accent' : 'ctl-quiet'}`}
            title="Every element Wokwi ships, and what the bench does with each"
          >
            Full library
          </button>
        </nav>

        {view === 'library' ? (
          <WokwiLibrary />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">

            {sections.length === 0 && (
              // Same rule as the sidebar: say what happened, show the way out.
              <div className="empty py-16">
                <MagnifyingGlassIcon className="icon text-slate-700" aria-hidden="true" />
                <p>
                  Nothing matches “{query.trim()}”.
                  <br />
                  Try a part name, or clear the filters above.
                </p>
              </div>
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
        )}
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
      <div className="relative mb-2 flex h-20 items-center justify-center rounded bg-slate-900/60 p-2">
        <PartPreview definition={definition} className="h-full w-full" />
        {/*
         * Every card's whole job is "put this on the bench", and that was only
         * discoverable by hovering. The badge says it before the pointer
         * arrives, and stays out of the way once it does.
         */}
        <span
          className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-slate-800 text-slate-400 transition-opacity group-hover:bg-sky-600 group-hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
          aria-hidden="true"
        >
          <PlusIcon className="icon-sm" />
        </span>
      </div>
      <span className="text-sm font-medium text-slate-100 group-hover:text-sky-300">
        {entry.name}
      </span>
      <span className="mt-0.5 text-xs leading-snug text-slate-500">{entry.note}</span>
      <span className="num mt-2 text-[10px] tracking-wide text-slate-600 uppercase">
        {definition.pins.length} pins · {definition.widthMm.toFixed(0)}×
        {definition.heightMm.toFixed(0)} mm
      </span>
    </button>
  );
}
