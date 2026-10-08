// src/features/bench/share-codec.ts
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { validateProject, type FirmwareProject } from '@/features/simulation';

export const SHARE_URL_LIMIT = 1800;

/** Shown under the editor when a `?files=` payload cannot be read. */
export const CORRUPT_SHARE_NOTICE =
  'That share link could not be read, so the bench opened a fresh project instead.';

export function encodeProjectToShare(project: FirmwareProject): string {
  return compressToEncodedURIComponent(JSON.stringify({ language: project.language, files: project.files }));
}

/*
 * Whether the project fits in a shareable link: the guard behind the header's
 * Copy-link button. Kept here (rather than inline in Bench) so the button and
 * the tests assert on the same condition.
 */
export function isShareable(project: FirmwareProject): boolean {
  return encodeProjectToShare(project).length <= SHARE_URL_LIMIT;
}

export function decodeShareToProject(payload: string): FirmwareProject | null {
  try {
    const raw = decompressFromEncodedURIComponent(payload);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { language: FirmwareProject['language']; files: { name: string; content: string }[] };
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    const candidate: FirmwareProject = { language: parsed.language, files: parsed.files, activeName: parsed.files[0].name };
    // A well-formed payload carrying an invalid project (wrong entry file,
    // bad names, over the caps) falls back the same way a corrupt one does.
    if (validateProject(candidate).length > 0) return null;
    return candidate;
  } catch {
    return null;
  }
}
