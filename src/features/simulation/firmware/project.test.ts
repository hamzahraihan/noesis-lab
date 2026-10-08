import { describe, expect, it } from 'vitest';
import { toSingleFileProject, validateProject } from './project';

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
});
