import type { ReactNode } from 'react';
import { CaretRightIcon, CrossCircledIcon } from '@radix-ui/react-icons';
import type { BottomKey } from '../store/shell-state';

const TABS: ReadonlyArray<{ id: BottomKey; label: string }> = [
  { id: 'serial', label: 'Serial' },
  { id: 'scope', label: 'Scope' },
  { id: 'logic', label: 'Logic' },
  { id: 'bus', label: 'Bus' },
  { id: 'meter', label: 'Multimeter' },
  { id: 'problems', label: 'Problems' },
];

export function BottomPanel({
  tab,
  open,
  hasError,
  height,
  onTab,
  onToggle,
  serial,
  scope,
  logic,
  bus,
  meter,
  problems,
}: {
  tab: BottomKey;
  open: boolean;
  hasError: boolean;
  /** Panel height in pixels when open, owned by the bench shell (draggable). */
  height: number;
  onTab(next: BottomKey): void;
  onToggle(): void;
  serial: ReactNode;
  scope: ReactNode;
  logic: ReactNode;
  bus: ReactNode;
  meter: ReactNode;
  problems: ReactNode;
}) {
  const body =
    tab === 'serial'
      ? serial
      : tab === 'scope'
        ? scope
        : tab === 'logic'
          ? logic
          : tab === 'bus'
            ? bus
            : tab === 'meter'
              ? meter
              : problems;
  return (
    <section
      style={open ? { height } : undefined}
      className={`flex shrink-0 flex-col border-t border-slate-800 bg-slate-900 ${open ? '' : 'h-9'}`}
    >
      <div
        role="tablist"
        aria-label="Bottom panel"
        className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto px-2"
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? 'Collapse bottom panel' : 'Expand bottom panel'}
          title="Toggle bottom panel (J)"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <CaretRightIcon
            className={`icon-sm transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
        </button>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              onTab(id);
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold tracking-[0.08em] uppercase ${
              tab === id ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            {label}
            {id === 'problems' && hasError && (
              <CrossCircledIcon className="icon-sm text-red-400" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      {open && <div className="min-h-0 flex-1 overflow-auto border-t border-slate-800">{body}</div>}
    </section>
  );
}
