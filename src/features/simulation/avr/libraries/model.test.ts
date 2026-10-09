import { describe, expect, it } from 'vitest';
import { CURATED_LIBRARIES, validateLibraries, type ProjectLibrary } from './model';

function projectWith(libraries: readonly ProjectLibrary[]) {
  return { language: 'arduino-cpp', activeName: 'main.ino', files: [{ name: 'main.ino', content: '' }], libraries } as const;
}

describe('library model', () => {
  it('curates exactly the six Tier-1 names', () => {
    expect(CURATED_LIBRARIES.map((entry) => entry.name)).toEqual(['Servo', 'DHT', 'Adafruit_GFX', 'Adafruit_SSD1306', 'Wire', 'SPI']);
    expect(CURATED_LIBRARIES.find((entry) => entry.name === 'Servo')?.headers).toContain('Servo.h');
  });

  it('accepts an empty declaration', () => {
    expect(validateLibraries(projectWith([]), { slots: [] })).toEqual([]);
  });

  it('rejects unknown provided names and missing slots, flags duplicates', () => {
    expect(validateLibraries(projectWith([{ name: 'Nope', source: 'provided' }]), { slots: [] })).toEqual([
      '<Nope>: unknown provided library',
    ]);
    expect(validateLibraries(projectWith([{ name: 'custom:gone', source: 'custom' }]), { slots: [] })).toEqual([
      '<custom:gone>: library slot is empty',
    ]);
    expect(
      validateLibraries(
        projectWith([
          { name: 'Servo', source: 'provided' },
          { name: 'Servo', source: 'provided' },
        ]),
        { slots: [] },
      ),
    ).toEqual(['<Servo>: duplicate library']);
  });

  it('ignores versions on Tier-1 entries', () => {
    expect(
      validateLibraries(projectWith([{ name: 'Servo', source: 'provided', version: '1.2.3' }]), { slots: [] }),
    ).toEqual([]);
  });
});
