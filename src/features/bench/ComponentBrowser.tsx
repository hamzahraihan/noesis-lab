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
} from '@/features/parts';
import type { PartDefinition } from '@/features/parts';
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  Tabs,
  TabsContent,
} from '@/components';
import { PartPreview } from './PartPreview';
import { WokwiLibrary } from './WokwiLibrary';
import { Cross2Icon, PlusIcon } from '@radix-ui/react-icons';

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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden bg-slate-900"
        aria-label="Component browser"
      >
        <DialogTitle className="sr-only">Component browser</DialogTitle>
        <DialogHeader className="flex shrink-0 flex-row items-center gap-2 border-b border-slate-800 p-3">
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search parts…"
            aria-label="Search parts"
            className="h-7"
          />
          <DialogClose asChild>
            <Button variant="secondary" size="icon-sm" aria-label="Close component browser">
              <Cross2Icon className="icon" aria-hidden="true" />
            </Button>
          </DialogClose>
        </DialogHeader>
        {/*
         * The view switch is a controlled Tabs whose value is driven by the
         * filter buttons below rather than TabsTriggers: a single-select Tabs
         * cannot model the (catalogue, group) pair, so the pills stay Buttons
         * and the panels switch on `view` via TabsContent.
         */}
        <Tabs
          value={view}
          onValueChange={(v) => setView(v as 'catalogue' | 'library')}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <nav
            className="flex shrink-0 items-center gap-1.5 border-b border-slate-800 px-4 py-2"
            aria-label="Component categories"
          >
            {[{ id: 'all', label: 'All' }, ...CATALOGUE_GROUPS].map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={view === 'catalogue' && group === option.id ? 'default' : 'secondary'}
                className="rounded-full"
                aria-pressed={view === 'catalogue' && group === option.id}
                onClick={() => {
                  setView('catalogue');
                  setGroup(option.id);
                }}
              >
                {option.label}
              </Button>
            ))}
            {/*
             * The catalogue is what the bench can hold. This is the whole library
             * behind it -- the parts that are not placeable yet, and why -- so
             * "there is no servo here" has an answer you can look at.
             */}
            <Button
              type="button"
              size="sm"
              variant={view === 'library' ? 'default' : 'secondary'}
              className="ml-auto rounded-full"
              aria-pressed={view === 'library'}
              title="Every element Wokwi ships, and what the bench does with each"
              onClick={() => setView('library')}
            >
              Full library
            </Button>
          </nav>

          <TabsContent value="catalogue" className="mt-0 min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="px-4 py-4">
                {matches.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center text-xs text-slate-500">
                    <p>No parts match “{query}”.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuery('');
                        setGroup('all');
                      }}
                    >
                      Clear search
                    </Button>
                  </div>
                )}
                {sections.map((section) => (
                  <section key={section.id} className="mb-6 last:mb-0">
                    <h3 className="mb-2">
                      <Badge variant="secondary">{section.label}</Badge>
                    </h3>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {section.entries.map((entry) => (
                        <CatalogueCard key={entry.id} entry={entry} onPlace={onPlace} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="library" className="mt-0 min-h-0 flex-1">
            <WokwiLibrary />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
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
