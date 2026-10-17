import { validateCircuit, compile, type CircuitDocument, type BenchSnapshot } from '@/features/simulation';
import type { DynamicState } from '@/features/parts';
import { CORRUPT_SAVE_NOTICE, CORRUPT_SHARE_NOTICE } from './project-store';

export const circuitStorageKey = (boardId: string) => `noesis:circuit:${boardId}`;

export function saveCircuit(boardId: string, doc: CircuitDocument, storage: Storage = localStorage): void {
  try {
    storage.setItem(circuitStorageKey(boardId), JSON.stringify(doc));
  } catch { /* quota or private mode: bench stays session-local */ }
}

export function loadCircuit(boardId: string, storage: Storage = localStorage): CircuitDocument | null {
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
  readonly pinned: boolean;
  readonly sharedPayload: string | null;
  readonly saved: CircuitDocument | null;
  readonly hadUnreadableSave: boolean;
  readonly decode: (payload: string) => CircuitDocument | null;
}

export interface CircuitSeed {
  readonly snapshot: BenchSnapshot | null;
  readonly dynamicState: DynamicState | null;
  readonly error: string | null;
}

export function resolveCircuitSeed(request: CircuitSeedRequest): CircuitSeed {
  if (request.pinned) return { snapshot: null, dynamicState: null, error: null };
  if (request.sharedPayload !== null) {
    const decoded = request.decode(request.sharedPayload);
    if (decoded !== null) {
      const result = compile(decoded);
      if (result.errors.length === 0) return { snapshot: result.snapshot, dynamicState: result.dynamicState, error: null };
    }
    return { snapshot: null, dynamicState: null, error: CORRUPT_SHARE_NOTICE };
  }
  if (request.saved !== null) {
    const result = compile(request.saved);
    if (result.errors.length === 0) return { snapshot: result.snapshot, dynamicState: result.dynamicState, error: null };
    return { snapshot: null, dynamicState: null, error: CORRUPT_SAVE_NOTICE };
  }
  if (request.hadUnreadableSave) return { snapshot: null, dynamicState: null, error: CORRUPT_SAVE_NOTICE };
  return { snapshot: null, dynamicState: null, error: null };
}
