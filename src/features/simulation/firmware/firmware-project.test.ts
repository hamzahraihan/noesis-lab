import { describe, expect, it } from 'vitest';
import { FirmwareRuntime } from './interpreter';

describe('fromProject', () => {
  it('calls a helper defined in another tab', () => {
    const runtime = FirmwareRuntime.fromProject({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [
        { name: 'main.ino', content: '#include "helpers.h"\nvoid setup() { blinkOnce(); }\nvoid loop() {}\n' },
        { name: 'helpers.h', content: 'void blinkOnce() { digitalWrite(2, 1); }\n' },
      ],
    });
    expect(runtime.hasFunction('blinkOnce')).toBe(true);
    expect(runtime.hasFunction('setup')).toBe(true);
  });

  it('reports duplicates naming both files', () => {
    expect(() =>
      FirmwareRuntime.fromProject({
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [
          { name: 'main.ino', content: 'void dup() {}\nvoid setup() {}\nvoid loop() {}\n' },
          { name: 'helpers.h', content: 'void dup() {}\n' },
        ],
      }),
    ).toThrow(/dup.*main\.ino.*helpers\.h|helpers\.h.*main\.ino/);
  });

  it('imports a sibling python module', () => {
    const runtime = FirmwareRuntime.fromProject({
      language: 'python',
      activeName: 'main.py',
      files: [
        { name: 'main.py', content: 'import helpers\n' },
        { name: 'helpers.py', content: 'def wave():\n  return 1\n' },
      ],
    });
    expect(runtime.hasFunction('wave')).toBe(true);
  });

  it('rejects include cycles', () => {
    expect(() =>
      FirmwareRuntime.fromProject({
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [
          { name: 'main.ino', content: '#include "a.h"\nvoid setup() {}\nvoid loop() {}\n' },
          { name: 'a.h', content: '#include "b.h"\n' },
          { name: 'b.h', content: '#include "a.h"\n' },
        ],
      }),
    ).toThrow(/cycle/i);
  });
});
