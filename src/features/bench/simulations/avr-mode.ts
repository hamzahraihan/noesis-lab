import type { BoardId } from '@/features/learn';

/**
 * Whether a backend can run on a board.
 *
 * The board is the limit for AVR: only the Uno carries a committed in-worker
 * toolchain build. The RP2040 engine is worker-only, so it also needs the
 * simulation worker. Both refusals carry the reason the selector shows on the
 * disabled option. Kept beside the bench because it is UI policy, not
 * simulation state.
 */
export type BackendAvailability = { ok: true } | { ok: false; reason: string };

export function avrAvailableFor(boardId: BoardId): BackendAvailability {
  if (boardId === 'uno') return { ok: true };
  return { ok: false, reason: 'AVR mode needs an Uno board' };
}

/**
 * Whether the RP2040 engine can run.
 *
 * The firmware path is seated on the Nano RP2040 Connect only (the engine is
 * board-agnostic, its wiring is not), and it lives in the simulation worker:
 * the main thread has no rp2040js in it by design. A bench without a worker
 * therefore refuses the mode rather than pretending to run it.
 */
export function rp2040AvailableFor(boardId: BoardId, worker: boolean): BackendAvailability {
  if (boardId !== 'rp2040') {
    return { ok: false, reason: 'RP2040 mode needs the Nano RP2040 Connect' };
  }
  if (!worker) return { ok: false, reason: 'RP2040 mode needs the simulation worker' };
  return { ok: true };
}

export interface BackendSelection {
  readonly value: 'avr' | 'interpreter' | 'rp2040';
  readonly interpreterDisabled: boolean;
  readonly interpreterTitle: string;
}

/**
 * Which backend the selector shows. Builds that name an execution pin to it
 * with the interpreter option disabled, so the slow path for class-heavy
 * sketches cannot be selected by accident. Every other project keeps the
 * current choice; the mode booleans are the operator's, and RP2040 wins over
 * AVR only because the two modes are mutually exclusive in the UI.
 */
export function resolveBackendSelection({
  execution,
  avr,
  rp2040,
  avrMode,
  rp2040Mode,
}: {
  readonly execution: 'interpreter' | 'avr' | 'rp2040' | undefined;
  readonly avr: BackendAvailability;
  readonly rp2040: BackendAvailability;
  readonly avrMode: boolean;
  readonly rp2040Mode: boolean;
}): BackendSelection {
  if (execution === 'avr') {
    return {
      value: 'avr',
      interpreterDisabled: true,
      interpreterTitle: 'This build runs on AVR only',
    };
  }
  if (execution === 'rp2040') {
    return {
      value: 'rp2040',
      interpreterDisabled: true,
      interpreterTitle: 'This build runs on RP2040 only',
    };
  }
  if (rp2040Mode && rp2040.ok) {
    return {
      value: 'rp2040',
      interpreterDisabled: false,
      interpreterTitle: 'Which backend the next Run executes on',
    };
  }
  return {
    value: avrMode && avr.ok ? 'avr' : 'interpreter',
    interpreterDisabled: false,
    interpreterTitle: avr.ok
      ? 'Which backend the next Run executes on'
      : avrMode
        ? avr.reason
        : 'Which backend the next Run executes on',
  };
}
