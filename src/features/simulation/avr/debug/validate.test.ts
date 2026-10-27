import { describe, expect, it } from 'vitest';
import { parseDebugInfo } from './validate';

const lines = [{ pc: 0, file: 'main.ino', line: 1 }];
const intType = { kind: 'base', name: 'int', byteSize: 2, encoding: 5 } as const;
const local = {
  name: 'a',
  type: 0,
  scope: 'local',
  location: { kind: 'expr', bytes: [0x8c, 0x05] },
  declLine: 6,
};
const global = {
  name: 'gCount',
  type: 0,
  scope: 'global',
  location: { kind: 'expr', bytes: [0x03, 0x00, 0x01, 0x80, 0x00] },
  declLine: 2,
};

describe('parseDebugInfo', () => {
  it('keeps a line-only payload backward compatible', () => {
    expect(parseDebugInfo({ lines })).toEqual({
      lines,
      functions: [],
      globals: [],
      types: [],
    });
  });

  it('accepts a full model', () => {
    const info = parseDebugInfo({
      lines,
      functions: [
        {
          lowPc: 0x100,
          highPc: 0x120,
          frameBase: { kind: 'expr', bytes: [0x92, 0x20, 0x02] },
          variables: [local],
        },
      ],
      globals: [global],
      types: [intType],
    });
    expect(info?.functions[0]?.variables[0]?.name).toBe('a');
    expect(info?.globals[0]?.scope).toBe('global');
    expect(info?.types[0]?.kind).toBe('base');
  });

  it('rejects a variable whose type index is out of range', () => {
    expect(
      parseDebugInfo({
        lines,
        functions: [],
        globals: [{ ...global, type: 1 }],
        types: [intType],
      }),
    ).toBeNull();
  });

  it('rejects a non-octet expression byte', () => {
    expect(
      parseDebugInfo({
        lines,
        functions: [],
        globals: [{ ...global, location: { kind: 'expr', bytes: [0x100] } }],
        types: [intType],
      }),
    ).toBeNull();
  });

  it('rejects a location range that ends before it begins', () => {
    expect(
      parseDebugInfo({
        lines,
        functions: [],
        globals: [
          {
            ...global,
            location: {
              kind: 'loclist',
              ranges: [{ begin: 0x120, end: 0x100, bytes: [0x8c, 0x05] }],
            },
          },
        ],
        types: [intType],
      }),
    ).toBeNull();
  });
});
