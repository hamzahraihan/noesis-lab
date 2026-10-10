// Pure helpers behind the FirmwareEditor's Library Manager browse surface:
// version badges, build-row labels, category lists, and advertised-only
// license notes. No React and no fetches, so the rules stay node-testable
// next to the panel that uses them (there is no component harness).
import type { IndexLibrary } from '@/features/simulation';

/** Browse search placeholder: name, header, and sentence queries all count. */
export const searchPlaceholder = 'Search libraries by name, header, or keyword…';

/** Per-row install state, with text-exact badges the browse and installed rows share. */
export function badgeFor(state: { readonly installed: string | null; readonly latest: string }): string {
  if (state.installed === null) return 'install';
  if (state.installed === state.latest) return `installed ${state.installed}`;
  return 'update available';
}

/** Installed build rows read `Name@version ✓ cached` after a verified build. */
export function buildRowLabel(name: string, version: string): string {
  return `${name}@${version} ✓ cached`;
}

/** Distinct sorted categories for the browse filter. */
export function indexCategories(libs: readonly IndexLibrary[]): string[] {
  return [...new Set(libs.map((lib) => lib.category))].sort();
}

export interface InstalledIndexEntry {
  readonly name: string;
  readonly version: string;
  /** License text only ever comes from advertised terms — never invented. */
  readonly license?: string;
}

/**
 * Footnote license terms for installed index libraries: only entries that
 * advertise license text contribute (the Arduino index itself advertises
 * none, so index rows render no line rather than a guess). Null means no
 * footnote line.
 */
export function indexLicenseNote(installed: readonly InstalledIndexEntry[]): string | null {
  const advertised = installed
    .filter((entry) => entry.license !== undefined && entry.license !== '')
    .map((entry) => `${entry.name} (${entry.license})`);
  if (advertised.length === 0) return null;
  return `Index libraries: ${advertised.join(', ')}.`;
}
