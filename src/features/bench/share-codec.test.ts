// src/features/bench/share-codec.test.ts
import { describe, expect, it } from 'vitest';
import { decodeShareToProject, encodeProjectToShare, SHARE_URL_LIMIT } from './share-codec';
import { toSingleFileProject } from '@/features/simulation';

describe('share codec', () => {
  it('round-trips a two-file project', () => {
    const project = {
      ...toSingleFileProject('#include "h.h"\nvoid setup() {}\nvoid loop() {}\n', 'arduino-cpp'),
      files: [
        { name: 'main.ino', content: '#include "h.h"\nvoid setup() {}\nvoid loop() {}\n' },
        { name: 'h.h', content: 'void helper() {}\n' },
      ],
    };
    const encoded = encodeProjectToShare(project);
    expect(encoded.length).toBeLessThan(SHARE_URL_LIMIT);
    expect(decodeShareToProject(encoded)).toEqual({ ...project, activeName: 'main.ino' });
  });

  it('rejects corrupt payloads', () => {
    expect(decodeShareToProject('!!!not-a-payload!!!')).toBeNull();
  });
});
