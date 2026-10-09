// Pure helpers behind the FirmwareEditor's Libraries section: slot-scoped
// Monaco view-state keys, `file:line` error matching for the slot editor's
// tab-switch, and validation-reason lookup for greyed rows. No React, so the
// matching rules stay node-testable next to the panel that uses them.
import type { LibrarySlot } from '@/features/simulation';

/** Monaco view-state key for a slot file: never collides with a tab name. */
export function slotViewKey(slotId: string, path: string): string {
  return `slot:${slotId}:${path}`;
}

export interface SlotFileMatch {
  readonly slotId: string;
  readonly path: string;
  readonly line: number;
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

/**
 * Matches a `path:line` origin (as `compileDetail` reports located worker
 * failures, possibly behind a `compile failed: ` prefix) against the
 * project's slot files: full path first, then original-casing basename.
 * Anything else — project tabs, bare notices, `<lib>` reasons — is not a
 * slot file and returns null.
 */
export function matchSlotFile(
  error: string | null | undefined,
  slots: readonly LibrarySlot[],
): SlotFileMatch | null {
  if (!error) return null;
  for (const match of error.matchAll(/([^:\s][^:]*?):(\d+)/g)) {
    const head = match[1] ?? '';
    const line = Number.parseInt(match[2] ?? '', 10);
    if (head === '' || !Number.isInteger(line) || line <= 0) continue;
    for (const slot of slots) {
      const found = slot.files.find((file) => file.path === head);
      if (found !== undefined) return { slotId: slot.id, path: found.path, line };
    }
    for (const slot of slots) {
      const found = slot.files.find((file) => baseName(file.path) === head);
      if (found !== undefined) return { slotId: slot.id, path: found.path, line };
    }
  }
  return null;
}

/** The `reason` half of a `<name>: reason` validation string, if it names `name`. */
export function reasonFor(name: string, errors: readonly string[]): string | null {
  const prefix = `<${name}>: `;
  for (const error of errors) {
    if (error.startsWith(prefix)) return error.slice(prefix.length);
  }
  return null;
}
