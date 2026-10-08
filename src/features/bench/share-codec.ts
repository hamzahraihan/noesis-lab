// src/features/bench/share-codec.ts
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { FirmwareProject } from '@/features/simulation';

export const SHARE_URL_LIMIT = 1800;

export function encodeProjectToShare(project: FirmwareProject): string {
  return compressToEncodedURIComponent(JSON.stringify({ language: project.language, files: project.files }));
}

export function decodeShareToProject(payload: string): FirmwareProject | null {
  try {
    const raw = decompressFromEncodedURIComponent(payload);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { language: FirmwareProject['language']; files: { name: string; content: string }[] };
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    return { language: parsed.language, files: parsed.files, activeName: parsed.files[0].name };
  } catch {
    return null;
  }
}
