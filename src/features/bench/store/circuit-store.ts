import { validateCircuit, compile, type CircuitDocument } from '@/features/simulation';
import { CORRUPT_SAVE_NOTICE, CORRUPT_SHARE_NOTICE } from './project-store';

export const circuitStorageKey = (boardId: string) => `noesis:circuit:${boardId}`;

/**
 * Shown when a circuit cannot be opened on the bench it arrived at.
 *
 * A document names the board it was written for (its MCU part), and the pin
 * model belongs to the board the bench runs: a circuit compiled against one and
 * placed on the other is drawn but wired to nothing, which is worse than not
 * opening it. Say so, rather than showing the compiler's version of it.
 */
export const WRONG_BOARD_NOTICE =
  'That circuit is not wired for this board, so the bench opened a fresh one instead.';

export function saveCircuit(
  boardId: string,
  doc: CircuitDocument,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(circuitStorageKey(boardId), JSON.stringify(doc));
  } catch {
    /* quota or private mode: bench stays session-local */
  }
}

export function loadCircuit(
  boardId: string,
  storage: Storage = localStorage,
): CircuitDocument | null {
  try {
    const raw = storage.getItem(circuitStorageKey(boardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (validateCircuit(parsed).length > 0) return null;
    const result = compile(parsed);
    if (result.errors.length > 0) return null;
    return parsed as CircuitDocument;
  } catch {
    return null;
  }
}

export function hasCircuit(boardId: string, storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(circuitStorageKey(boardId)) !== null;
  } catch {
    return false;
  }
}

export interface CircuitSeedRequest {
  /**
   * The definition id of the board this bench runs (`boardOption(id).make().id`).
   * A circuit names the board it was written for, and the two have to agree.
   */
  readonly boardDefinitionId: string;
  readonly pinned: boolean;
  readonly sharedPayload: string | null;
  readonly saved: CircuitDocument | null;
  readonly hadUnreadableSave: boolean;
  readonly decode: (payload: string) => CircuitDocument | null;
}

export interface CircuitSeed {
  readonly circuit: CircuitDocument | null;
  readonly error: string | null;
}

/**
 * The circuit the bench should open with, or the reason it could not.
 *
 * Precedence is the firmware's: a pinned build, then `?circuit=`, then the
 * autosave, then nothing -- and the caller builds the starting bench for
 * "nothing". The document is handed back rather than a compiled snapshot, so
 * the bench seeds through one primitive (`Simulation.loadCircuit`) whichever
 * way the circuit arrived.
 *
 * Only a document that compiles *and* names this bench's board comes back.
 * `loadCircuit` refuses the same two things before it puts anything down; the
 * check is here as well so the caller can say it in a sentence.
 */
export function resolveCircuitSeed(request: CircuitSeedRequest): CircuitSeed {
  const accepted = (doc: CircuitDocument, corruptNotice: string): CircuitSeed => {
    const result = compile(doc);
    if (result.errors.length > 0) return { circuit: null, error: corruptNotice };
    const board = result.bench?.parts.find((part) => part.definition.component.kind === 'mcu');
    if (!board || board.definition.id !== request.boardDefinitionId) {
      return { circuit: null, error: WRONG_BOARD_NOTICE };
    }
    return { circuit: doc, error: null };
  };

  if (request.pinned) return { circuit: null, error: null };
  if (request.sharedPayload !== null) {
    const decoded = request.decode(request.sharedPayload);
    if (decoded === null) return { circuit: null, error: CORRUPT_SHARE_NOTICE };
    return accepted(decoded, CORRUPT_SHARE_NOTICE);
  }
  if (request.saved !== null) return accepted(request.saved, CORRUPT_SAVE_NOTICE);
  if (request.hadUnreadableSave) return { circuit: null, error: CORRUPT_SAVE_NOTICE };
  return { circuit: null, error: null };
}
