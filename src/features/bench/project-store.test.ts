// src/features/bench/project-store.test.ts
import { describe, expect, it } from 'vitest';
import { benchProjectKey, loadBenchProject, saveBenchProject } from './project-store';
import { toSingleFileProject } from '@/features/simulation';

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
});
