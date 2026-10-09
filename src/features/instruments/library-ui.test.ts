// Slot-editor helpers: view-state keys, error-to-slot matching, reason lookup.
import { describe, expect, it } from 'vitest';
import { matchSlotFile, reasonFor, slotViewKey } from './library-ui';
import type { LibrarySlot } from '@/features/simulation';

const SLOTS: readonly LibrarySlot[] = [
  {
    id: 'm',
    name: 'MyLib',
    files: [
      { path: 'MyLib.h', content: 'x\n' },
      { path: 'src/MyLib.cpp', content: 'y\n' },
    ],
  },
];

describe('slot view keys', () => {
  it('scopes keys per slot and path', () => {
    expect(slotViewKey('m', 'MyLib.h')).toBe('slot:m:MyLib.h');
    expect(slotViewKey('m', 'MyLib.h')).not.toBe(slotViewKey('other', 'MyLib.h'));
    expect(slotViewKey('m', 'MyLib.h')).not.toBe('MyLib.h');
  });
});

describe('matchSlotFile', () => {
  it('matches a full slot path with its line', () => {
    expect(matchSlotFile('src/MyLib.cpp:12: boom', SLOTS)).toEqual({
      slotId: 'm',
      path: 'src/MyLib.cpp',
      line: 12,
    });
  });

  it('finds the origin behind a compile-failed prefix', () => {
    expect(matchSlotFile('compile failed: MyLib.cpp:3: boom', SLOTS)).toEqual({
      slotId: 'm',
      path: 'src/MyLib.cpp',
      line: 3,
    });
  });

  it('matches an original-casing basename', () => {
    expect(matchSlotFile('MyLib.h:3: boom', SLOTS)).toEqual({
      slotId: 'm',
      path: 'MyLib.h',
      line: 3,
    });
  });

  it('ignores project tabs, notices, and empty errors', () => {
    expect(matchSlotFile('main.ino:5: boom', SLOTS)).toBeNull();
    expect(matchSlotFile('MyLib.h: file already exists', SLOTS)).toBeNull();
    expect(matchSlotFile('<Nope>: unknown provided library', SLOTS)).toBeNull();
    expect(matchSlotFile(null, SLOTS)).toBeNull();
    expect(matchSlotFile('', SLOTS)).toBeNull();
  });
});

describe('reasonFor', () => {
  it('returns the validation reason for a declared name', () => {
    const errors = ['<Nope>: unknown provided library', '<custom:gone>: library slot is empty'];
    expect(reasonFor('Nope', errors)).toBe('unknown provided library');
    expect(reasonFor('custom:gone', errors)).toBe('library slot is empty');
    expect(reasonFor('Servo', errors)).toBeNull();
  });
});
