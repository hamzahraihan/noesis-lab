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
