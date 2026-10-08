// src/features/bench/share-codec.test.ts
import { describe, expect, it } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import { decodeShareToProject, encodeProjectToShare, isShareable, SHARE_URL_LIMIT } from './share-codec';
import { toSingleFileProject, validateProject } from '@/features/simulation';

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

  it('rejects well-formed payloads that fail project validation', () => {
    // No entry file: decodes cleanly but is not a project the bench can open.
    const noEntry = compressToEncodedURIComponent(
      JSON.stringify({ language: 'arduino-cpp', files: [{ name: 'helpers.h', content: 'x\n' }] }),
    );
    expect(decodeShareToProject(noEntry)).toBeNull();
    // Wrong extension for the language.
    const wrongLanguage = compressToEncodedURIComponent(
      JSON.stringify({ language: 'arduino-cpp', files: [{ name: 'main.py', content: 'x\n' }] }),
    );
    expect(decodeShareToProject(wrongLanguage)).toBeNull();
  });

  it('keeps small projects shareable', () => {
    const project = toSingleFileProject('void setup() {}\nvoid loop() {}\n', 'arduino-cpp');
    expect(isShareable(project)).toBe(true);
  });

  it('flags a capped-size project whose payload exceeds the URL limit', () => {
    // Deterministic high-entropy filler: lz-string cannot compress it away,
    // so the payload stays large while the project stays within the caps.
    let state = 0x12345678;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) % 62;
    };
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const filler = Array.from({ length: 6000 }, () => alphabet[next()]).join('');
    const project = toSingleFileProject(`void setup() {}\nvoid loop() {}\n// ${filler}\n`, 'arduino-cpp');
    expect(validateProject(project)).toEqual([]);
    expect(encodeProjectToShare(project).length).toBeGreaterThan(SHARE_URL_LIMIT);
    expect(isShareable(project)).toBe(false);
  });
});
