import type { ReactNode } from 'react';
import { addFile, removeFile, renameFile, type FirmwareProject } from '@/features/simulation';
import { Button } from '@/components';
import type { Activity } from '../store/shell-state';

export function Sidebar({
  activity,
  project,
  entryName,
  activeName,
  width,
  onSelectFile,
  onProjectChange,
  componentsPane,
  libraryPane,
}: {
  activity: Activity;
  project: FirmwareProject;
  entryName: string;
  activeName: string;
  /** Panel width in pixels, owned by the bench shell (draggable divider). */
  width: number;
  onSelectFile(name: string): void;
  onProjectChange(next: FirmwareProject): void;
  componentsPane: ReactNode;
  libraryPane: ReactNode;
}) {
  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col border-r border-slate-800 bg-slate-900"
    >
      <div className="flex h-9 shrink-0 items-center border-b border-slate-800 px-3 text-[11px] font-semibold tracking-[0.08em] text-slate-400 uppercase">
        {activity === 'files' ? 'Explorer' : activity === 'components' ? 'Components' : 'Library'}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activity === 'files' && (
          <ul aria-label="Firmware files" className="min-h-0 flex-1 overflow-y-auto p-1">
            {project.files.map((file) => {
              const selected = file.name === activeName;
              const isEntry = file.name === entryName;
              return (
                <li key={file.name}>
                  <div
                    className={`flex items-center rounded-none font-mono text-xs ${
                      selected ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectFile(file.name)}
                      onDoubleClick={() => {
                        if (isEntry) return;
                        const next = window.prompt('Rename file', file.name);
                        if (!next || next.trim() === file.name) return;
                        try {
                          onProjectChange(renameFile(project, file.name, next.trim()));
                        } catch {
                          // Panels.tsx notice pattern owns the error surface; sidebar stays quiet.
                        }
                      }}
                      title={isEntry ? `${file.name} (entry)` : `${file.name} — double-click to rename`}
                      className="flex-1 truncate rounded-none px-2 py-1.5 text-left transition-colors hover:text-slate-100"
                    >
                      {file.name}
                    </button>
                    {!isEntry && (
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            onProjectChange(removeFile(project, file.name));
                          } catch {
                            // Same as above: editor notice surface owns errors.
                          }
                        }}
                        aria-label={`Remove ${file.name}`}
                        className="rounded-none px-2 py-1 text-slate-500 transition-colors hover:text-red-300"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {activity === 'files' && (
          <div className="shrink-0 border-t border-slate-800 p-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full font-mono"
              onClick={() => {
                const name = window.prompt('New file name', 'helpers.h');
                if (!name || !name.trim()) return;
                try {
                  onProjectChange(addFile(project, name.trim()));
                } catch {
                  // Editor notice surface owns errors.
                }
              }}
            >
              + New file
            </Button>
          </div>
        )}
        {activity === 'components' && componentsPane}
        {activity === 'library' && libraryPane}
      </div>
    </aside>
  );
}
