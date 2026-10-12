import type { BoardId } from '@/features/learn';

/**
 * Whether the AVR backend can run on a board.
 *
 * Only the Uno carries a committed in-worker toolchain build; every other
 * board refuses with the reason the selector shows on its disabled option.
 * Kept beside the bench because it is UI policy, not simulation state.
 */
export type AvrAvailability = { ok: true } | { ok: false; reason: string };

export function avrAvailableFor(boardId: BoardId): AvrAvailability {
  if (boardId === 'uno') return { ok: true };
  return { ok: false, reason: 'AVR mode needs an Uno board' };
}

export interface BackendSelection {
  readonly value: 'avr' | 'interpreter';
  readonly interpreterDisabled: boolean;
  readonly interpreterTitle: string;
}

/**
 * Which backend the selector shows. AVR-only gallery builds (execution
 * 'avr') pin to AVR with the interpreter option disabled, so the slow
 * interpreter path for class-heavy sketches cannot be selected by accident.
 * Every other project keeps the current choice; title logic matches the
 * selector's previous inline behavior exactly.
 */
export function resolveBackendSelection({
  execution,
  avr,
  avrMode,
}: {
  readonly execution: 'interpreter' | 'avr' | undefined;
  readonly avr: AvrAvailability;
  readonly avrMode: boolean;
}): BackendSelection {
  if (execution === 'avr') {
    return {
      value: 'avr',
      interpreterDisabled: true,
      interpreterTitle: 'This build runs on AVR only',
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
