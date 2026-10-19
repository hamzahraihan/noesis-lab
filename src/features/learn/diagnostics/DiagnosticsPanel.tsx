/**
 * Gallery smoke harness panel: runs every registry entry live and reports.
 *
 * One row per gallery build with its scripted checks, a Run button, and a
 * session-only manual checkbox (preserved across re-runs). Run-all walks the
 * registry sequentially through `runHarness`; each report is stamped with its
 * `projectId`/`buildLabel` (the runner leaves those blank and fills metrics
 * via the counting sim wrapper) and appended as a `formatReport` block. The
 * alarm-clock library entry carries an extended wall cap for the
 * worker-compile check (~150 s measured, over the 120 s runner default);
 * other entries run under the default. Cancel stops between checks; an
 * in-flight compile runs to its cap.
 */

import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components';
import { formatReport, runHarness } from './harness';
import { buildRegistry, type RegistryEntry } from './registry';

const DEFAULT_WALL_CAP_MS = 120_000;

function entryKey(entry: RegistryEntry): string {
  return `${entry.projectId}@${entry.buildLabel}`;
}

export function DiagnosticsPanel() {
  const entries = useMemo(() => buildRegistry(), []);
  const cancelRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    readonly done: number;
    readonly total: number;
  } | null>(null);
  const [summary, setSummary] = useState<Record<string, string>>({});
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState('');

  async function runEntry(entry: RegistryEntry): Promise<void> {
    const key = entryKey(entry);
    setActiveKey(key);
    setProgress({ done: 0, total: entry.checks.length });
    setSummary((prev) => ({ ...prev, [key]: 'running' }));
    try {
      const raw = await runHarness(entry.checks, entry.makeSim, {
        onProgress: (done, total) => setProgress({ done, total }),
        isCancelled: () => cancelRef.current,
        yieldEvery: 1,
        wallCapMs: entry.extendedCapMs ?? DEFAULT_WALL_CAP_MS,
      });
      const stamped = { ...raw, projectId: entry.projectId, buildLabel: entry.buildLabel };
      const block = formatReport(stamped);
      setReport((prev) => (prev === '' ? block : `${prev}\n\n${block}`));
      const passed = stamped.results.filter((result) => result.status === 'pass').length;
      setSummary((prev) => ({
        ...prev,
        [key]: `${String(passed)}/${String(stamped.results.length)} pass`,
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSummary((prev) => ({ ...prev, [key]: `error: ${detail}` }));
      const block = `${entry.projectId} (${entry.buildLabel}): error — ${detail}`;
      setReport((prev) => (prev === '' ? block : `${prev}\n\n${block}`));
    }
  }

  function manualSection(keys: readonly string[], flags: Record<string, boolean>): string {
    return `manual:\n${keys.map((key) => `${key}=${String(flags[key] === true)}`).join('\n')}`;
  }

  async function handleRunAll(): Promise<void> {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);
    setReport('');
    try {
      for (const entry of entries) {
        if (cancelRef.current) break;
        await runEntry(entry);
      }
      // Cancel stops between checks; an in-flight compile runs to its cap.
      setReport((prev) =>
        prev === ''
          ? manualSection(entries.map(entryKey), manual)
          : `${prev}\n\n${manualSection(entries.map(entryKey), manual)}`,
      );
    } finally {
      setRunning(false);
      setActiveKey(null);
      setProgress(null);
    }
  }

  async function handleRunOne(entry: RegistryEntry): Promise<void> {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);
    try {
      await runEntry(entry);
      const key = entryKey(entry);
      setReport((prev) =>
        prev === '' ? manualSection([key], manual) : `${prev}\n\n${manualSection([key], manual)}`,
      );
    } finally {
      setRunning(false);
      setActiveKey(null);
      setProgress(null);
    }
  }

  function handleCancel(): void {
    cancelRef.current = true;
  }

  return (
    <div className="min-h-screen bg-[var(--hd-bg-deep)] text-[var(--hd-text)]">
      <header className="border-b border-[var(--hd-border)]">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <Button asChild variant="secondary" size="sm">
            <Link to="/">Boards</Link>
          </Button>
          <span className="text-[var(--hd-faint)]">/</span>
          <span className="text-sm text-[var(--hd-muted)]">Gallery diagnostics</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-[var(--hd-text)]">
          Smoke-test the gallery
        </h1>
        <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-[var(--hd-muted)]">
          Runs every finished build through its scripted checks on a live sim. Manual ticks are
          session-only and survive re-runs.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void handleRunAll()} disabled={running}>
            Run all
          </Button>
          <Button size="sm" variant="secondary" onClick={handleCancel} disabled={!running}>
            Cancel
          </Button>
          {running && activeKey !== null && progress !== null ? (
            <span className="text-sm text-[var(--hd-muted)]" role="status">
              Running {activeKey}: {String(progress.done)}/{String(progress.total)}
            </span>
          ) : null}
        </div>
        <div className="mt-6 overflow-x-auto rounded-none border border-[var(--hd-border)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--hd-border)] text-xs text-[var(--hd-muted)]">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Project
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Build
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Checks
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Result
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Manual
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const key = entryKey(entry);
                const isActive = running && activeKey === key;
                return (
                  <tr key={key} className="border-b border-[var(--hd-border)] last:border-0">
                    <td className="px-4 py-2.5 text-[var(--hd-text)]">{entry.projectId}</td>
                    <td className="px-4 py-2.5 text-[var(--hd-muted)]">{entry.buildLabel}</td>
                    <td className="px-4 py-2.5 text-[var(--hd-muted)]">{String(entry.checks.length)}</td>
                    <td className="px-4 py-2.5 text-[var(--hd-muted)]">{summary[key] ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={manual[key] === true}
                        onChange={(event) =>
                          setManual((prev) => ({ ...prev, [key]: event.target.checked }))
                        }
                        aria-label={`Manually verified ${entry.projectId} ${entry.buildLabel}`}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      {isActive ? (
                        <Button size="sm" variant="secondary" onClick={handleCancel}>
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleRunOne(entry)}
                          disabled={running}
                        >
                          Run
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-6">
          <label
            htmlFor="diagnostics-report"
            className="text-sm font-semibold tracking-tight text-[var(--hd-text)]"
          >
            Report
          </label>
          <textarea
            id="diagnostics-report"
            readOnly
            value={report}
            onFocus={(event) => event.currentTarget.select()}
            rows={20}
            placeholder="No runs yet — Run all or Run a single build."
            className="mt-2 w-full rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)]/60 px-4 py-3 font-mono text-xs leading-relaxed text-[var(--hd-text)]"
          />
        </div>
      </main>
    </div>
  );
}
