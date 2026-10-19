import { type ReactNode, useState } from 'react';
import { Component1Icon } from '@radix-ui/react-icons';
import type { CenterKey } from '../store/shell-state';
import { isCircuitKey } from '../store/shell-state';

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
  const [editorMounted, setEditorMounted] = useState(!circuitActive);
  /*
   * Latched during render rather than in an effect: the pane must not paint one
   * empty frame between a tab click and the editor arriving, and the latch is
   * one-way -- switching back to the canvas must not tear Monaco down and lose
   * the cursor and scroll positions of every open tab.
   */
  if (!circuitActive && !editorMounted) setEditorMounted(true);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Editor tabs"
        className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--hd-border)] bg-[var(--hd-surface)] px-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={circuitActive}
          onClick={() => onSelect('circuit')}
          title="Circuit canvas"
          className={`flex shrink-0 items-center gap-1.5 rounded-none px-2 py-1 font-mono text-xs ${
            circuitActive ? 'bg-[var(--hd-border)] text-[var(--hd-text)]' : 'text-[var(--hd-muted)] hover:text-[var(--hd-text)]'
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
              className={`flex shrink-0 items-center rounded-none font-mono text-xs ${
                selected ? 'bg-[var(--hd-border)] text-[var(--hd-text)]' : 'text-[var(--hd-muted)]'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(file.name)}
                onDoubleClick={() => {
                  if (!isEntry) onRenameFile(file.name);
                }}
                title={isEntry ? file.name : `${file.name} — double-click to rename`}
                className="rounded-none px-2 py-1 transition-colors hover:text-[var(--hd-text)]"
              >
                {file.name}
              </button>
              {!isEntry && (
                <button
                  type="button"
                  onClick={() => onCloseFile(file.name)}
                  aria-label={`Remove ${file.name}`}
                  className="rounded-none px-1 py-1 text-[var(--hd-muted)] transition-colors hover:text-red-300"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      {/*
       * Both panes stay mounted once they have been shown; the inactive one
       * hides. Unmounting the editor would destroy the Monaco instance and its
       * per-tab view states (cursor, scroll), and unmounting the canvas would
       * reset its pan/zoom — so a tab switch would feel like a reload. A hidden
       * pane costs a DOM subtree.
       *
       * The editor waits for its first show, though: it carries Monaco, which
       * is megabytes a lesson session may never need, and the canvas has no
       * download of its own to wait for.
       */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={`min-h-0 flex-1 ${circuitActive ? 'flex flex-col' : 'hidden'}`}>
          {circuit}
        </div>
        <div className={`min-h-0 flex-1 ${circuitActive ? 'hidden' : 'flex flex-col'}`}>
          {editorMounted ? editor : null}
        </div>
      </div>
    </div>
  );
}
