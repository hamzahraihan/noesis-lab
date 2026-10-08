import { describe, expect, it } from 'vitest';
import { addFile, removeFile, renameFile, toSingleFileProject, validateProject } from './project';

describe('toSingleFileProject', () => {
  it('wraps a sketch as the entry file', () => {
    const project = toSingleFileProject('void setup() {}', 'arduino-cpp');
    expect(project.files).toEqual([{ name: 'main.ino', content: 'void setup() {}' }]);
    expect(project.activeName).toBe('main.ino');
  });
});

describe('validateProject', () => {
  it('rejects uppercase names', () => {
    const errors = validateProject({
      language: 'arduino-cpp',
      activeName: 'Helpers.H',
      files: [{ name: 'Helpers.H', content: 'x' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects more than 8 files', () => {
    const files = [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }];
    for (let index = 0; index < 8; index += 1) files.push({ name: `h${index}.h`, content: 'x\n' });
    expect(files).toHaveLength(9);
    const errors = validateProject({ language: 'arduino-cpp', activeName: 'main.ino', files });
    expect(errors.some((error) => /more than 8 files/.test(error))).toBe(true);
  });

  it('rejects files larger than 32 KB', () => {
    const errors = validateProject({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: 'x'.repeat(32 * 1024 + 1) }],
    });
    expect(errors.some((error) => /larger than 32 KB/.test(error))).toBe(true);
  });
});

describe('tab helpers', () => {
  it('protects the entry file', () => {
    const project = toSingleFileProject('x', 'arduino-cpp');
    expect(() => removeFile(project, 'main.ino')).toThrow(/entry/i);
    expect(() => renameFile(project, 'main.ino', 'other.ino')).toThrow(/entry/i);
  });

  it('adds a helper tab', () => {
    const project = toSingleFileProject('x', 'arduino-cpp');
    const next = addFile(project, 'helpers.h');
    expect(next.files.map((f) => f.name)).toEqual(['main.ino', 'helpers.h']);
    expect(next.activeName).toBe('helpers.h');
  });
});
