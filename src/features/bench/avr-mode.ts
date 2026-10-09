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
