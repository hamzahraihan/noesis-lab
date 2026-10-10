import { useMemo, useState } from 'react';
import { CATALOGUE_GROUPS, type CatalogueEntry } from '@/features/parts';
import type { PartDefinition } from '@/features/parts';
import { matchCatalogue } from '../utils/catalogue-filter';
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
import { PlusIcon } from '@radix-ui/react-icons';

export function CatalogueGrid({
  onPlace,
}: {
  onPlace(definition: PartDefinition, entry: CatalogueEntry): void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const matches = useMemo(() => matchCatalogue(query, group), [query, group]);
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
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
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
          <section key={section.id} className="mb-4 last:mb-0">
            <h3 className="mb-1.5">
              <Badge variant="secondary">{section.label}</Badge>
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {section.entries.map((entry) => (
                <CatalogueCard key={entry.id} entry={entry} onPlace={onPlace} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function CatalogueCard({
  entry,
  onPlace,
}: {
  entry: CatalogueEntry;
  onPlace(definition: PartDefinition, entry: CatalogueEntry): void;
}) {
  const definition = useMemo(() => entry.make(), [entry]);
  return (
    <button
      type="button"
      onClick={() => onPlace(definition, entry)}
      className="group flex flex-col rounded-lg border border-slate-800 bg-slate-950 p-2 text-left transition-colors hover:border-sky-600 hover:bg-slate-900"
    >
      <div className="relative mb-1.5 flex h-16 items-center justify-center rounded bg-slate-900/60 p-1.5">
        <PartPreview definition={definition} className="h-full w-full" />
        <span
          className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-slate-800 text-slate-400 transition-opacity group-hover:bg-sky-600 group-hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
          aria-hidden="true"
        >
          <PlusIcon className="icon-sm" />
        </span>
      </div>
      <span className="text-xs font-medium text-slate-100 group-hover:text-sky-300">{entry.name}</span>
      <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">{entry.note}</span>
    </button>
  );
}
