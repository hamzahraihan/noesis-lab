// src/features/bench/project-store.ts
import { validateProject, type FirmwareProject } from '@/features/simulation';
import { CORRUPT_SHARE_NOTICE } from './share-codec';

export const benchProjectKey = (boardId: string) => `noesis:bench:${boardId}:project`;

/** Shown under the editor when this board's autosave exists but cannot be read. */
export const CORRUPT_SAVE_NOTICE =
  'The saved project could not be read, so the bench opened a fresh project instead.';

export function saveBenchProject(boardId: string, project: FirmwareProject, storage: Storage = localStorage): void {
  try {
    storage.setItem(benchProjectKey(boardId), JSON.stringify({ language: project.language, files: project.files, activeName: project.activeName }));
  } catch { /* quota or private mode: bench stays session-local */ }
}

export function loadBenchProject(boardId: string, storage: Storage = localStorage): FirmwareProject | null {
  try {
    const raw = storage.getItem(benchProjectKey(boardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FirmwareProject;
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    const candidate: FirmwareProject = { language: parsed.language, files: parsed.files, activeName: parsed.activeName };
    // A save from an older shape, a hand-edited slot, or over-the-cap content
    // never reaches the editor: it falls back the same way a corrupt one does.
    if (validateProject(candidate).length > 0) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** Whether this board has an autosave slot at all (readable or not). */
export function hasBenchProject(boardId: string, storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(benchProjectKey(boardId)) !== null;
  } catch {
    return false;
  }
}

export interface BenchSeedRequest {
  /** Fresh starter for this board (exercise/build sketch already folded in). */
  readonly starter: FirmwareProject;
  /** True when `?ex=` / `?project=` named a build: it wins over everything. */
  readonly pinned: boolean;
  /** Raw `?files=` payload, or null when the URL carries none. */
  readonly sharedPayload: string | null;
  /** This board's validated autosave, or null when absent or unreadable. */
  readonly saved: FirmwareProject | null;
  /** True when a save exists but failed validation (slot present, `saved` null). */
  readonly hadUnreadableSave: boolean;
  /** Share decoder, injected so the helper stays pure and node-testable. */
  readonly decode: (payload: string) => FirmwareProject | null;
}

export interface BenchSeed {
  readonly project: FirmwareProject;
  readonly shareError: string | null;
}

/*
 * Mount precedence, extracted from Bench so it is node-testable: the exercise
 * or gallery build wins, then the `?files=` share payload, then this board's
 * autosave, then the starter. Anything unreadable falls back to the starter
 * with an error line under the editor, never a blank bench.
 */
export function resolveBenchSeed(request: BenchSeedRequest): BenchSeed {
  if (request.pinned) return { project: request.starter, shareError: null };
  if (request.sharedPayload !== null) {
    const decoded = request.decode(request.sharedPayload);
    if (decoded !== null) return { project: decoded, shareError: null };
    return { project: request.starter, shareError: CORRUPT_SHARE_NOTICE };
  }
  if (request.saved !== null) return { project: request.saved, shareError: null };
  if (request.hadUnreadableSave) return { project: request.starter, shareError: CORRUPT_SAVE_NOTICE };
  return { project: request.starter, shareError: null };
}
