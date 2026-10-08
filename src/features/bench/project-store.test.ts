// src/features/bench/project-store.test.ts
import { describe, expect, it } from 'vitest';
import {
  benchProjectKey,
  hasBenchProject,
  loadBenchProject,
  resolveBenchSeed,
  saveBenchProject,
} from './project-store';
import { toSingleFileProject, type FirmwareProject } from '@/features/simulation';

describe('project store', () => {
  it('round-trips through injected storage', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const project = toSingleFileProject('void setup() {}\n', 'arduino-cpp');
    saveBenchProject('uno', project, storage as Storage);
    expect(loadBenchProject('uno', storage as Storage)).toEqual(project);
    expect(benchProjectKey('uno')).toBe('noesis:bench:uno:project');
  });

  it('returns null on corrupt saves', () => {
    const storage = {
      getItem: () => '{broken',
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage;
    expect(loadBenchProject('uno', storage)).toBeNull();
  });

  it('returns null when the save fails project validation', () => {
    const backing = new Map<string, string>([
      [benchProjectKey('uno'), JSON.stringify({ language: 'arduino-cpp', files: [{ name: 'helpers.h', content: 'x\n' }], activeName: 'helpers.h' })],
    ]);
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    // No entry file: parses cleanly but is not a project the bench can open.
    expect(loadBenchProject('uno', storage as Storage)).toBeNull();
    // The slot exists, so the seed reports an unreadable save rather than none.
    expect(hasBenchProject('uno', storage as Storage)).toBe(true);
  });

  it('reports no save when the slot is empty', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage;
    expect(hasBenchProject('uno', storage)).toBe(false);
  });
});

describe('resolveBenchSeed', () => {
  const starter = toSingleFileProject('void setup() {}\nvoid loop() {}\n', 'arduino-cpp');
  const saved: FirmwareProject = {
    ...toSingleFileProject('saved\n', 'arduino-cpp'),
    files: [{ name: 'main.ino', content: 'saved\n' }],
  };
  const shared: FirmwareProject = {
    language: 'arduino-cpp',
    activeName: 'main.ino',
    files: [
      { name: 'main.ino', content: '#include "h.h"\nvoid setup() {}\nvoid loop() {}\n' },
      { name: 'h.h', content: 'void helper() {}\n' },
    ],
  };
  const decode = (payload: string): FirmwareProject | null =>
    payload === 'valid-payload' ? shared : null;

  it('prefers the exercise or gallery build over everything', () => {
    const seed = resolveBenchSeed({
      starter,
      pinned: true,
      sharedPayload: 'valid-payload',
      saved,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed).toEqual({ project: starter, shareError: null });
  });

  it('prefers the share payload over the autosave', () => {
    const seed = resolveBenchSeed({
      starter,
      pinned: false,
      sharedPayload: 'valid-payload',
      saved,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed).toEqual({ project: shared, shareError: null });
  });

  it('falls back to the starter with a notice on a corrupt share link', () => {
    const seed = resolveBenchSeed({
      starter,
      pinned: false,
      sharedPayload: 'bogus',
      saved,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed.project).toEqual(starter);
    expect(seed.shareError).toMatch(/share link/);
  });

  it('prefers the autosave over the starter', () => {
    const seed = resolveBenchSeed({
      starter,
      pinned: false,
      sharedPayload: null,
      saved,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed).toEqual({ project: saved, shareError: null });
  });

  it('falls back to the starter with a notice on an unreadable save', () => {
    const seed = resolveBenchSeed({
      starter,
      pinned: false,
      sharedPayload: null,
      saved: null,
      hadUnreadableSave: true,
      decode,
    });
    expect(seed.project).toEqual(starter);
    expect(seed.shareError).toMatch(/saved project/);
  });

  it('opens the starter quietly with nothing to load', () => {
    const seed = resolveBenchSeed({
      starter,
      pinned: false,
      sharedPayload: null,
      saved: null,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed).toEqual({ project: starter, shareError: null });
  });
});
