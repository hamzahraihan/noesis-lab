// Pure tab/activity state for the VS Code-style bench shell.
//
// Node-testable by design: no React, no DOM. The shell components in this
// directory consume these helpers so the bench layout stays a thin view over
// plain state transitions.
export type Activity = 'files' | 'components' | 'library';
export type CenterKey = 'circuit' | string;
export type BottomKey = 'serial' | 'scope' | 'logic' | 'bus' | 'meter' | 'problems';

export function centerKeyForFile(name: string): CenterKey {
  return name;
}

export function isCircuitKey(key: CenterKey): boolean {
  return key === 'circuit';
}

export function bottomTabForError(error: string | null): BottomKey {
  return error !== null && error !== '' ? 'problems' : 'serial';
}

export function nextActivity(
  current: Activity,
  clicked: Activity,
  sidebarOpen: boolean,
): { activity: Activity; sidebarOpen: boolean } {
  if (clicked === current) return { activity: current, sidebarOpen: !sidebarOpen };
  return { activity: clicked, sidebarOpen: true };
}

/**
 * Which center tab a firmware error head belongs to, if any.
 *
 * Error heads name files (`helpers.h:12: ...`) but also libraries and boards
 * (`Servo: ...`), which have no tab. Null means "not a file tab, stay put".
 */
export function resolveErrorCenter(head: string, fileNames: readonly string[]): CenterKey | null {
  if (head === '' || !fileNames.includes(head)) return null;
  return centerKeyForFile(head);
}

/**
 * Repairs a center key against the current file list.
 *
 * File ops (sidebar remove/rename, example loads, language and board
 * switches) replace `project.files` without touching the center, so a key
 * naming a deleted file would highlight no tab while the editor showed
 * another file. Returns the key untouched when it still resolves.
 */
export function repairCenterKey(
  active: CenterKey,
  files: ReadonlyArray<{ name: string }>,
  fallback: string,
): CenterKey {
  if (isCircuitKey(active)) return active;
  if (files.some((file) => file.name === active)) return active;
  return centerKeyForFile(fallback);
}

// ---------------------------------------------------------------------------
// Adjustable panel sizes. Pure and node-testable: storage is injected so
// tests pass a Map instead of localStorage.
// ---------------------------------------------------------------------------

export interface LayoutSizes {
  sidebarWidth: number;
  bottomHeight: number;
  railWidth: number;
}

export const DEFAULT_LAYOUT: LayoutSizes = {
  sidebarWidth: 256,
  bottomHeight: 192,
  railWidth: 240,
};

/** Storage key for the persisted bench layout. */
export const LAYOUT_KEY = 'noesis:bench:layout';

const LAYOUT_LIMITS = {
  sidebarWidth: [176, 480],
  bottomHeight: [120, 560],
  railWidth: [200, 480],
} as const;

/**
 * Clamps every dimension into its limits. `viewportHeight` caps the bottom
 * panel at half the window, so a tall drag cannot squeeze the canvas away;
 * without it the fixed ceiling applies.
 */
export function clampLayoutSizes(sizes: LayoutSizes, viewportHeight?: number): LayoutSizes {
  const maxBottom =
    viewportHeight === undefined ? LAYOUT_LIMITS.bottomHeight[1] : Math.floor(viewportHeight / 2);
  const clamp = (value: number, [min, max]: readonly [number, number]) =>
    Math.min(Math.max(Math.round(value), min), max);
  return {
    sidebarWidth: clamp(sizes.sidebarWidth, LAYOUT_LIMITS.sidebarWidth),
    bottomHeight: clamp(sizes.bottomHeight, [LAYOUT_LIMITS.bottomHeight[0], maxBottom]),
    railWidth: clamp(sizes.railWidth, LAYOUT_LIMITS.railWidth),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Reads the persisted layout. Missing, corrupt, or partial saves fall back
 * to defaults per field, and anything out of range is clamped — a hostile or
 * stale payload can never wedge the shell.
 */
export function loadLayoutSizes(read: (key: string) => string | null): LayoutSizes {
  let raw: unknown = null;
  try {
    const text = read(LAYOUT_KEY);
    raw = text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    raw = null;
  }
  const saved =
    typeof raw === 'object' && raw !== null ? (raw as Partial<Record<keyof LayoutSizes, unknown>>) : {};
  return clampLayoutSizes({
    sidebarWidth: isFiniteNumber(saved.sidebarWidth) ? saved.sidebarWidth : DEFAULT_LAYOUT.sidebarWidth,
    bottomHeight: isFiniteNumber(saved.bottomHeight) ? saved.bottomHeight : DEFAULT_LAYOUT.bottomHeight,
    railWidth: isFiniteNumber(saved.railWidth) ? saved.railWidth : DEFAULT_LAYOUT.railWidth,
  });
}

/** Persists the layout; callers debounce. Failures stay silent by contract. */
export function saveLayoutSizes(
  write: (key: string, value: string) => void,
  sizes: LayoutSizes,
): void {
  try {
    write(LAYOUT_KEY, JSON.stringify(sizes));
  } catch {
    // Private-mode quotas and the like: sizes stay session-only.
  }
}
