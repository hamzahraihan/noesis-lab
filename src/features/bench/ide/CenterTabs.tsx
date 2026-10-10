import type { ReactNode } from 'react';
import { Component1Icon } from '@radix-ui/react-icons';
import type { CenterKey } from './shell-state';
import { isCircuitKey } from './shell-state';

export function CenterTabs({
  active,
  files,
  entryName,
  onSelect,
  onCloseFile,
  onRenameFile,
  circuit,
  editor,
}: {
  active: CenterKey;
  files: ReadonlyArray<{ name: string }>;
  entryName: string;
  onSelect(key: CenterKey): void;
  onCloseFile(name: string): void;
  onRenameFile(name: string): void;
  circuit: ReactNode;
  editor: ReactNode;
}) {
  const circuitActive = isCircuitKey(active);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Editor tabs"
        className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900 px-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={circuitActive}
          onClick={() => onSelect('circuit')}
          title="Circuit canvas"
          className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs ${
            circuitActive ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          <Component1Icon className="icon-sm" aria-hidden="true" />
          Circuit
        </button>
        {files.map((file) => {
          const selected = active === file.name;
          const isEntry = file.name === entryName;
          return (
            <span
              key={file.name}
              role="tab"
              aria-selected={selected}
              className={`flex shrink-0 items-center rounded-md font-mono text-xs ${
                selected ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(file.name)}
                onDoubleClick={() => {
                  if (!isEntry) onRenameFile(file.name);
                }}
                title={isEntry ? file.name : `${file.name} — double-click to rename`}
                className="rounded-md px-2 py-1 transition-colors hover:text-slate-100"
              >
                {file.name}
              </button>
              {!isEntry && (
                <button
                  type="button"
                  onClick={() => onCloseFile(file.name)}
                  aria-label={`Remove ${file.name}`}
                  className="rounded-md px-1 py-1 text-slate-500 transition-colors hover:text-red-300"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      {/*
       * Both panes stay mounted; the inactive one hides. Unmounting the editor
       * would destroy the Monaco instance and its per-tab view states (cursor,
       * scroll), and unmounting the canvas would reset its pan/zoom — so a tab
       * switch would feel like a reload. A hidden pane costs a DOM subtree.
       */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={`min-h-0 flex-1 ${circuitActive ? 'flex flex-col' : 'hidden'}`}>{circuit}</div>
        <div className={`min-h-0 flex-1 ${circuitActive ? 'hidden' : 'flex flex-col'}`}>{editor}</div>
      </div>
    </div>
  );
}
