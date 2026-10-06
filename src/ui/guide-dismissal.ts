/**
 * Whether the exercise guide stays closed for an exercise.
 *
 * The guide auto-opens when a bench arrives through `?ex=:id`, and the footer
 * offers "Don't auto-open" for learners who already know the drill. That
 * choice is per exercise, in localStorage, so one dismissal never silences a
 * different lesson.
 */

function dismissedKey(id: string): string {
  return `noesis-lab:guide-dismissed:${id}`;
}

export function isGuideDismissed(id: string): boolean {
  try {
    return localStorage.getItem(dismissedKey(id)) === '1';
  } catch {
    return false;
  }
}

export function setGuideDismissed(id: string, dismissed: boolean): void {
  try {
    if (dismissed) localStorage.setItem(dismissedKey(id), '1');
    else localStorage.removeItem(dismissedKey(id));
  } catch {
    // Private mode or no storage: the guide just opens next time.
  }
}
