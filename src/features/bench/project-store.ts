// src/features/bench/project-store.ts
import type { FirmwareProject } from '@/features/simulation';

export const benchProjectKey = (boardId: string) => `noesis:bench:${boardId}:project`;

export function saveBenchProject(boardId: string, project: FirmwareProject, storage: Storage = localStorage): void {
  try {
    storage.setItem(benchProjectKey(boardId), JSON.stringify({ language: project.language, files: project.files, activeName: project.activeName }));
  } catch { /* quota or private mode: bench stays session-local */ }
}

export function loadBenchProject(boardId: string, storage: Storage = localStorage): FirmwareProject | null {
  try {
    const raw = storage.getItem(benchProjectKey(boardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FirmwareProject;
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    return { language: parsed.language, files: parsed.files, activeName: parsed.activeName };
  } catch {
    return null;
  }
}
