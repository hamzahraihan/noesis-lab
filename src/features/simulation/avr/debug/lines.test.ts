import { describe, expect, it } from 'vitest';
import type { PackedLine } from '../packager';
import type { RawDebugLine } from './dwarf';
import {
  buildDebugLines,
  lineAt,
  nextDebugLine,
  parseDebugInfo,
  pcsForLine,
  type DebugLine,
} from './lines';

function row(address: number, file: string, line: number, endSequence = false): RawDebugLine {
  return { address, file, line, column: 0, endSequence };
}

const firmwareMap: PackedLine[] = [
  { file: 'main.ino', line: 1 },
  { file: 'main.ino', line: 2 },
  { file: 'helper.ino', line: 7 },
];
const helperMap: PackedLine[] = [
  { file: 'helper.ino', line: 1 },
  { file: 'helper.ino', line: 2 },
];

describe('compiled debug line mapping', () => {
  it('maps DWARF byte addresses to AVR words and TU lines to tabs', () => {
    const lines = buildDebugLines(
      [
        row(0x100, '/build/HorangFirmware.cpp', 2),
        row(0x104, '/build/HorangFirmware.cpp', 3),
        row(0x108, '/build/Helper.cpp', 2),
        row(0x10c, '/build/HorangFirmware.cpp', 2, true),
      ],
      [
        { unit: 'HorangFirmware.cpp', lineMap: firmwareMap },
        { unit: 'Helper.cpp', lineMap: helperMap },
      ],
    );
    expect(lines).toEqual([
      { pc: 0x80, file: 'main.ino', line: 2 },
      { pc: 0x82, file: 'helper.ino', line: 7 },
      { pc: 0x84, file: 'helper.ino', line: 2 },
    ]);
  });

  it('keeps distinct source rows at one PC and drops synthetic or unknown rows', () => {
    const lines = buildDebugLines(
      [
        row(0x100, '/build/HorangFirmware.cpp', 1), // <packager> synthetic include
        row(0x102, '/build/HorangFirmware.cpp', 2),
        row(0x102, '/build/HorangFirmware.cpp', 3), // same PC, both lines are real
        row(0x102, '/build/HorangFirmware.cpp', 3), // exact duplicate
        row(0x104, '/usr/include/string.h', 4),
        row(0x106, '/build/Unknown.cpp', 1),
      ],
      [
        {
          unit: 'HorangFirmware.cpp',
          lineMap: [
            { file: '<packager>', line: 0 },
            { file: 'main.ino', line: 2 },
            { file: 'main.ino', line: 3 },
          ],
        },
      ],
    );
    expect(lines).toEqual([
      { pc: 0x81, file: 'main.ino', line: 2 },
      { pc: 0x81, file: 'main.ino', line: 3 },
    ]);
  });

  it('finds the line covering a PC and the next distinct line', () => {
    const lines: DebugLine[] = [
      { pc: 10, file: 'main.ino', line: 1 },
      { pc: 12, file: 'main.ino', line: 1 },
      { pc: 14, file: 'main.ino', line: 2 },
      { pc: 20, file: 'helper.ino', line: 4 },
    ];
    expect(lineAt(lines, 9)).toBeNull();
    expect(lineAt(lines, 13)).toEqual({ pc: 12, file: 'main.ino', line: 1 });
    expect(nextDebugLine(lines, 10)).toEqual({ pc: 14, file: 'main.ino', line: 2 });
    expect(nextDebugLine(lines, 14)).toEqual({ pc: 20, file: 'helper.ino', line: 4 });
    expect(nextDebugLine(lines, 20)).toBeNull();
  });

  it('treats several rows at one PC as breakpoint targets', () => {
    const lines: DebugLine[] = [
      { pc: 10, file: 'main.ino', line: 6 },
      { pc: 10, file: 'main.ino', line: 7 },
      { pc: 12, file: 'main.ino', line: 8 },
    ];
    expect(pcsForLine(lines, 'main.ino', 6)).toEqual([10]);
    expect(pcsForLine(lines, 'main.ino', 7)).toEqual([10]);
    // The later statement is the instruction's canonical line.
    expect(lineAt(lines, 10)).toEqual({ pc: 10, file: 'main.ino', line: 7 });
    expect(nextDebugLine(lines, 10)).toEqual({ pc: 12, file: 'main.ino', line: 8 });
  });

  it('finds every word a source line starts on, ignoring file case', () => {
    const lines: DebugLine[] = [
      { pc: 10, file: 'Main.ino', line: 3 },
      { pc: 12, file: 'main.ino', line: 3 },
      { pc: 14, file: 'main.ino', line: 4 },
    ];
    expect(pcsForLine(lines, 'MAIN.INO', 3)).toEqual([10, 12]);
    expect(pcsForLine(lines, 'main.ino', 9)).toEqual([]);
  });
});

describe('debug info boundary guard', () => {
  it('accepts dense rows and rejects malformed payloads', () => {
    expect(parseDebugInfo({ lines: [{ pc: 4, file: 'main.ino', line: 2 }] })).toEqual({
      lines: [{ pc: 4, file: 'main.ino', line: 2 }],
      functions: [],
      globals: [],
      types: [],
    });
    expect(parseDebugInfo(null)).toBeNull();
    expect(parseDebugInfo({ lines: 'nope' })).toBeNull();
    expect(parseDebugInfo({ lines: [{ pc: -1, file: 'main.ino', line: 2 }] })).toBeNull();
    expect(parseDebugInfo({ lines: [{ pc: 4, file: '', line: 2 }] })).toBeNull();
    expect(parseDebugInfo({ lines: [] })).toBeNull();
  });
});
