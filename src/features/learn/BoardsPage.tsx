/**
 * The board picker: a dedicated index of every board the bench can be built
 * around, in the herdr.dev/plugins style — a searchable, sortable grid of
 * cards, each one a real board with its real specs.
 *
 * Nothing here is invented. Counts and electrical facts come from `boardSpecs`,
 * and the editorial lines come from `boardRegistry`. The page only arranges them.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BOARDS, boardSpecs, DEFAULT_BOARD_ID } from './boardRegistry';
import { BoardArt } from './HomePage';
import { Navbar, SkipLink } from '@/components';

type SortKey = 'name' | 'gpio' | 'adc' | 'logic';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'gpio', label: 'Most GPIO' },
  { key: 'adc', label: 'Highest ADC' },
  { key: 'logic', label: 'Logic voltage' },
];

export function BoardsPage() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [filter, setFilter] = useState<'all' | '5v' | '3v3' | 'adc' | 'sbc'>('all');

  const boards = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = BOARDS.filter((board) => {
      const specs = boardSpecs(board.id);
      if (filter === '5v' && specs.logicVolts !== 5) return false;
      if (filter === '3v3' && specs.logicVolts !== 3.3) return false;
      if (filter === 'adc' && specs.adcCount === 0) return false;
      if (filter === 'sbc' && board.id !== 'raspberry-pi') return false;
      if (!q) return true;
      return (
        board.name.toLowerCase().includes(q) ||
        board.summary.toLowerCase().includes(q) ||
        board.bestFor.toLowerCase().includes(q)
      );
    });

    const sorted = [...filtered].sort((a, b) => {
      const sa = boardSpecs(a.id);
      const sb = boardSpecs(b.id);
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'gpio') return sb.gpioCount - sa.gpioCount;
      if (sort === 'adc') return sb.adcBits - sa.adcBits;
      if (sort === 'logic') return sb.logicVolts - sa.logicVolts;
      return 0;
    });

    return sorted;
  }, [query, sort, filter]);

  return (
    <div className="min-h-full bg-[var(--hd-bg)] text-[var(--hd-text)] antialiased hd-grid font-['Noto_Sans']">
      <SkipLink />
      <div className="mx-auto min-h-screen max-w-7xl border-x border-[var(--hd-border)] bg-[var(--hd-bg)]">
      <Navbar defaultBoardId={DEFAULT_BOARD_ID} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-6 py-12">
        <header className="mb-10">
          <div className="mb-4 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[var(--hd-muted)]">
            <span className="h-px w-8 bg-[var(--hd-accent)]" aria-hidden="true" />
            the board index
          </div>
          <h1 className="font-['Archivo'] text-[clamp(2rem,5vw,3.5rem)] font-black leading-[0.95] tracking-tight text-[var(--hd-text)]">
            Pick the board you would like to use.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--hd-muted)]">
            {BOARDS.length} boards, every one a real microcontroller footprint the
            bench builds from. Search, filter, or sort; click a card to open its
            bench. Listings are not reviewed by anyone — choose at your own
            discretion, and check the specs before you wire.
          </p>
        </header>

        {/* Controls */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex-1">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="search boards, specs, or use cases…"
              className="w-full rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)] px-4 py-2.5 text-sm text-[var(--hd-text)] placeholder:text-[var(--hd-faint)] focus:border-[var(--hd-accent)] focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['all', '5v', '3v3', 'adc', 'sbc'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={
                  filter === key
                    ? 'rounded-none border border-[var(--hd-accent)] bg-[var(--hd-accent)]/10 px-3 py-1.5 text-xs font-medium text-[var(--hd-accent)]'
                    : 'rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)] px-3 py-1.5 text-xs font-medium text-[var(--hd-muted)] transition-colors hover:border-[var(--hd-border-strong)] hover:text-[var(--hd-text)]'
                }
              >
                {key === 'all'
                  ? 'All'
                  : key === '5v'
                    ? '5 V'
                    : key === '3v3'
                      ? '3.3 V'
                      : key === 'adc'
                        ? 'Has ADC'
                        : 'SBC'}
              </button>
            ))}
          </div>
        </div>

        {/* Sort */}
        <div className="mb-6 flex flex-wrap items-center gap-3 text-xs">
          <span className="uppercase tracking-[0.2em] text-[var(--hd-faint)]">sort</span>
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSort(option.key)}
              className={
                sort === option.key
                  ? 'text-[var(--hd-accent)]'
                  : 'text-[var(--hd-muted)] transition-colors hover:text-[var(--hd-text)]'
              }
            >
              {option.label}
            </button>
          ))}
          <span className="ml-auto text-[var(--hd-faint)]">
            {boards.length} of {BOARDS.length} boards
          </span>
        </div>

        {/* Grid */}
        {boards.length === 0 ? (
          <div className="rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)] p-10 text-center text-sm text-[var(--hd-muted)]">
            No boards match your search.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => {
              const specs = boardSpecs(board.id);
              return (
                <article
                  key={board.id}
                  className="flex flex-col gap-3 rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)] p-4 transition-colors hover:border-[var(--hd-border-strong)]"
                >
                  <div
                    aria-hidden="true"
                    className="flex h-36 items-center justify-center rounded-none border border-[var(--hd-border)] bg-[var(--hd-bg-deep)] p-3"
                  >
                    <BoardArt board={board} className="h-full w-full" />
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-['Archivo'] text-lg font-bold tracking-tight text-[var(--hd-text)]">
                      {board.name}
                    </h2>
                    {board.id === DEFAULT_BOARD_ID && (
                      <span className="shrink-0 rounded-none bg-[var(--hd-border)] px-2 py-0.5 text-xs font-medium text-[var(--hd-muted)]">
                        Start here
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--hd-muted)]">{board.summary}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-none bg-[var(--hd-border)] px-2 py-0.5 font-['JetBrains_Mono'] text-xs text-[var(--hd-text)]">
                      {specs.logicVolts}V
                    </span>
                    <span className="rounded-none bg-[var(--hd-border)] px-2 py-0.5 font-['JetBrains_Mono'] text-xs text-[var(--hd-text)]">
                      {specs.adcCount > 0 ? `${specs.adcBits}-bit ADC` : 'no ADC'}
                    </span>
                    <span className="rounded-none bg-[var(--hd-border)] px-2 py-0.5 font-['JetBrains_Mono'] text-xs text-[var(--hd-text)]">
                      {specs.gpioCount} GPIO
                    </span>
                    <span className="rounded-none bg-[var(--hd-border)] px-2 py-0.5 font-['JetBrains_Mono'] text-xs text-[var(--hd-text)]">
                      {specs.pwmHz} Hz PWM
                    </span>
                    {specs.inputOnlyCount > 0 && (
                      <span className="rounded-none bg-[var(--hd-border)] px-2 py-0.5 font-['JetBrains_Mono'] text-xs text-[var(--hd-text)]">
                        {specs.inputOnlyCount} input-only
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--hd-faint)]">
                    {board.bestFor}
                  </p>
                  <Link
                    to={`/projects/${board.id}`}
                    className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-[var(--hd-accent)] transition-colors hover:text-[var(--hd-accent-hover)]"
                  >
                    Open bench <span aria-hidden="true">→</span>
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </main>
      </div>
    </div>
  );
}