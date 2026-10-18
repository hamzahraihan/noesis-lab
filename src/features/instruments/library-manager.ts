// Pure helpers behind the FirmwareEditor's Library Manager browse surface:
// version badges, build-row labels, category lists, advertised-only
// license notes, and the async install landing shapes. No React and no
// fetches, so the rules stay node-testable next to the panel that uses
// them (there is no component harness).
import type { IndexLibrary } from '@/features/simulation';
import type { FirmwareProject } from '@/features/simulation/firmware/project';

/** Browse search placeholder: name, header, and sentence queries all count. */
export const searchPlaceholder = 'Search libraries by name, header, or keyword…';

/** Per-row install state, with text-exact badges the browse and installed rows share. */
export function badgeFor(state: {
  readonly installed: string | null;
  readonly latest: string;
}): string {
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

/*
 * Async install landing: same-name rows replace so reinstalls re-pin rather
 * than duplicate. Pure so the concurrent-edit case stays unit-testable: the
 * panel spreads `projectRef.current` (fresh each render) through here at
 * land time, never the `project` value closed over when the install started.
 */
export function applyIndexInstall(
  project: FirmwareProject,
  name: string,
  version: string,
): FirmwareProject {
  const libraries = project.libraries ?? [];
  return {
    ...project,
    libraries: [
      ...libraries.filter((entry) => entry.name !== name),
      { name, source: 'index', version },
    ],
  };
}

/** Minimal fetch surface the archive download needs (global fetch satisfies it). */
export interface ArchiveFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/*
 * Archive download with the install's abort signal wired into the transfer
 * itself: cancelling during a large download aborts the fetch rather than
 * waiting it out. Throws `library fetch failed for <url>: <status>` on HTTP
 * errors, mirroring the panel's previous inline behavior.
 */
export async function fetchIndexArchive(
  url: string,
  fetchImpl: (url: string, init: { signal: AbortSignal }) => Promise<ArchiveFetchResponse>,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error(`library fetch failed for ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
