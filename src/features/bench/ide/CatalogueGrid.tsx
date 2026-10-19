import { useMemo, useState } from 'react';
import { CATALOGUE_GROUPS, useCustomPartsStore, type CatalogueEntry } from '@/features/parts';
import type { PartDefinition } from '@/features/parts';
import { matchCatalogue, matchesCatalogueQuery } from '../utils/catalogue-filter';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  Button,
} from '@/components';
import { PartPreview } from '../components/PartPreview';
import { Cross2Icon, PlusIcon } from '@radix-ui/react-icons';

export function CatalogueGrid({
  locked = false,
  onPlace,
}: {
  /**
   * True while the simulation is running: dropping a part onto the bench is a
   * layout edit the run refuses, so the cards come disabled rather than
   * silently doing nothing.
   */
  locked?: boolean;
  onPlace(definition: PartDefinition, entry: CatalogueEntry): void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const matches = useMemo(() => matchCatalogue(query, group), [query, group]);

  /*
   * Imported parts, in a section of their own.
   *
   * Their own rather than mixed into the shipped groups, because the thing an
   * operator needs to be able to see is *which* parts of this bench arrived from
   * a file -- that is the part they can take away again. The entry shape is the
   * catalogue's, so the card, the search and the placement path are the same
   * ones the shipped parts use.
   */
  const customParts = useCustomPartsStore((state) => state.parts);
  const removeCustomPart = useCustomPartsStore((state) => state.remove);
  const customEntries = useMemo<CatalogueEntry[]>(
    () =>
      customParts.map((part) => ({
        id: part.id,
        name: part.name,
        group: part.category,
        note: 'Imported part',
        make: () => part,
      })),
    [customParts],
  );
  const customMatches = useMemo(
    () =>
      group === 'all' || group === 'custom'
        ? customEntries.filter((entry) => matchesCatalogueQuery(entry, query))
        : [],
    [customEntries, group, query],
  );
  const sections = useMemo(
    () =>
      CATALOGUE_GROUPS.map((heading) => ({
        ...heading,
        entries: matches.filter((entry) => entry.group === heading.id),
      })).filter((section) => section.entries.length > 0),
    [matches],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 p-2">
        <Input
          id="part-search"
          name="part-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search parts…"
          aria-label="Search components"
          className="h-7 text-xs"
        />
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Component category</span>
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="h-7 w-full text-xs" aria-label="Component category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {CATALOGUE_GROUPS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
              {customParts.length > 0 && <SelectItem value="custom">Custom</SelectItem>}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {matches.length === 0 && customMatches.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center text-xs text-[var(--hd-muted)]">
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
          <section key={section.id} className="mb-4 last:mb-0">
            <h3 className="mb-1.5">
              <Badge variant="secondary">{section.label}</Badge>
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {section.entries.map((entry) => (
                <CatalogueCard key={entry.id} entry={entry} locked={locked} onPlace={onPlace} />
              ))}
            </div>
          </section>
        ))}
        {customMatches.length > 0 && (
          <section className="mb-4 last:mb-0">
            <h3 className="mb-1.5">
              <Badge variant="secondary">Custom</Badge>
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {customMatches.map((entry) => (
                <div key={entry.id} className="relative">
                  <CatalogueCard entry={entry} locked={locked} onPlace={onPlace} />
                  {/*
                   * Removal lives here, beside the part it removes: an imported
                   * part is the one thing in this list the operator owns, and
                   * the one they need to be able to take back.
                   */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${entry.name}`}
                    title={`Remove ${entry.name} from this bench's parts`}
                    onClick={() => removeCustomPart(entry.id)}
                    className="absolute top-1 left-1 size-5 rounded-none bg-[var(--hd-border)]/80 text-white hover:bg-rose-600 hover:text-white"
                  >
                    <Cross2Icon className="icon-sm" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function CatalogueCard({
  entry,
  locked,
  onPlace,
}: {
  entry: CatalogueEntry;
  locked: boolean;
  onPlace(definition: PartDefinition, entry: CatalogueEntry): void;
}) {
  const definition = useMemo(() => entry.make(), [entry]);
  return (
    <button
      type="button"
      onClick={() => onPlace(definition, entry)}
      disabled={locked}
      title={locked ? 'Pause the run to edit the bench' : undefined}
      className="group flex flex-col rounded-none border border-[var(--hd-border)] bg-[var(--hd-bg-deep)] p-2 text-left transition-colors hover:border-[var(--hd-accent)] hover:bg-[var(--hd-surface)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--hd-border)] disabled:hover:bg-[var(--hd-bg-deep)]"
    >
      <div className="relative mb-1.5 flex h-16 items-center justify-center rounded-none bg-[var(--hd-surface)]/60 p-1.5">
        <PartPreview definition={definition} className="h-full w-full" />
        <span
          className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-none bg-[var(--hd-border)] text-white transition-opacity group-hover:bg-[var(--hd-accent)] group-hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
          aria-hidden="true"
        >
          <PlusIcon className="icon-sm" />
        </span>
      </div>
      <span className="text-xs font-medium text-[var(--hd-text)] group-hover:text-[var(--hd-accent)]">
        {entry.name}
      </span>
      <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-[var(--hd-muted)]">
        {entry.note}
      </span>
    </button>
  );
}
