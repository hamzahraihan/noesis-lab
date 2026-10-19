/**
 * Shared theme handling: ink (dark), paper (light), or system (follows the OS).
 *
 * The choice is persisted in localStorage under `noesis-theme`. When set to
 * `system`, the document's `data-theme` follows `prefers-color-scheme` and
 * updates live when the OS preference changes.
 */

export type ThemeChoice = 'system' | 'ink' | 'paper';

const STORAGE_KEY = 'noesis-theme';

export function resolveTheme(choice: ThemeChoice): 'ink' | 'paper' {
  if (choice === 'ink' || choice === 'paper') return choice;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'paper';
  }
  return 'ink';
}

export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(choice));
  try {
    localStorage.setItem('noesis-theme', choice);
  } catch {
    /* ignore */
  }
}

export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'ink' || v === 'paper' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

/**
 * Subscribe to OS theme changes while `choice === 'system'`. Returns an
 * unsubscribe function.
 */
export function watchSystemTheme(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => callback();
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}