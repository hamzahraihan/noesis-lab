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
