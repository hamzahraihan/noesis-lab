import type { FirmwareProject } from '@/features/simulation';

/**
 * What the last Run put into the active backend: the sketch it loaded, the
 * backend it landed on, the wiring it was built against, and which backend
 * currently owns stepping. A Run that follows a Pause resumes the paused core
 * only while every field still matches; any difference falls back to the
 * usual load-and-compile path. Kept beside the bench because this is UI
 * policy about the Run button, not simulation state.
 */
export interface RunSession {
  readonly project: FirmwareProject;
  readonly backend: 'avr' | 'interpreter' | 'rp2040';
  readonly benchRevision: number;
  readonly owner: 'worker' | 'in-page';
}

/**
 * Whether a paused bench still holds exactly the run this record describes.
 *
 * `project` compares by identity on purpose: every edit produces a fresh
 * project object, so any sketch change (including examples and shares) misses
 * and recompiles. `benchRevision` catches structural wiring edits, which the
 * worker answers by rebuilding its core from the sources.
 */
export function canResumeRun(session: RunSession | null, next: RunSession): boolean {
  return (
    session !== null &&
    session.project === next.project &&
    session.backend === next.backend &&
    session.benchRevision === next.benchRevision &&
    session.owner === next.owner
  );
}
