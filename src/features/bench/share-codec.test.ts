// src/features/bench/share-codec.test.ts
import { describe, expect, it } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import { decodeShareToProject, encodeProjectToShare, isShareable, SHARE_URL_LIMIT } from './share-codec';
import { toSingleFileProject, validateProject, type FirmwareProject } from '@/features/simulation';

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

  it('round-trips libraries and slots through the share codec', () => {
    const project: FirmwareProject = {
      ...toSingleFileProject('void setup() {}\nvoid loop() {}\n', 'arduino-cpp'),
      libraries: [{ name: 'SevSeg', source: 'provided' }],
      slots: [{ id: 'm', name: 'MyLib', files: [{ path: 'MyLib.h', content: 'int libAdd(int a, int b);\n' }] }],
    };
    const encoded = encodeProjectToShare(project);
    expect(encoded.length).toBeLessThan(SHARE_URL_LIMIT);
    expect(decodeShareToProject(encoded)).toEqual({ ...project, activeName: 'main.ino' });
  });

  it('rejects well-formed payloads with unknown library shapes', () => {
    const badLibraries = compressToEncodedURIComponent(
      JSON.stringify({
        language: 'arduino-cpp',
        files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
        libraries: [{ name: 'SevSeg', source: 'sideways' }],
      }),
    );
    expect(decodeShareToProject(badLibraries)).toBeNull();
    const badSlots = compressToEncodedURIComponent(
      JSON.stringify({
        language: 'arduino-cpp',
        files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
        slots: [{ id: 'm', name: 'MyLib', files: [{ path: '/abs.h', content: 'x\n' }] }],
      }),
    );
    expect(decodeShareToProject(badSlots)).toBeNull();
  });

  it('flags slots pushing the URL over the limit as unshareable, editor untouched', () => {
    // Same deterministic high-entropy filler as above, carried in a slot file:
    // the payload no longer fits a link, while the project itself stays valid.
    let state = 0x12345678;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) % 62;
    };
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const filler = Array.from({ length: 6000 }, () => alphabet[next()]).join('');
    const project: FirmwareProject = {
      ...toSingleFileProject('void setup() {}\nvoid loop() {}\n', 'arduino-cpp'),
      libraries: [{ name: 'custom:m', source: 'custom' }],
      slots: [{ id: 'm', name: 'MyLib', files: [{ path: 'MyLib.h', content: `// ${filler}\n` }] }],
    };
    expect(validateProject(project)).toEqual([]);
    expect(encodeProjectToShare(project).length).toBeGreaterThan(SHARE_URL_LIMIT);
    expect(isShareable(project)).toBe(false);
    // Oversize reports unshareable; the editor path still round-trips it.
    expect(decodeShareToProject(encodeProjectToShare(project))).toEqual({
      ...project,
      activeName: 'main.ino',
    });
  });
});
