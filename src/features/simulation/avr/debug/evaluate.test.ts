import { describe, expect, it } from 'vitest';
import { readVariables } from './evaluate';
import type { CompiledDebugInfo, DebugType } from './model';

const TYPES: DebugType[] = [
  { kind: 'base', name: 'int', byteSize: 2, encoding: 5 }, // 0
  { kind: 'base', name: 'long int', byteSize: 4, encoding: 5 }, // 1
  { kind: 'base', name: 'char', byteSize: 1, encoding: 6 }, // 2
  {
    kind: 'struct',
    name: 'Pt',
    byteSize: 4,
    members: [
      { name: 'x', offset: 0, type: 0 },
      { name: 'y', offset: 2, type: 0 },
    ],
  }, // 3
  { kind: 'array', target: 0, count: 3, byteSize: 6 }, // 4
  { kind: 'pointer', byteSize: 2, target: 0 }, // 5
  { kind: 'base', name: 'bool', byteSize: 1, encoding: 2 }, // 6
  { kind: 'base', name: 'float', byteSize: 4, encoding: 4 }, // 7
  {
    kind: 'enum',
    name: 'Color',
    byteSize: 1,
    target: 0,
    enumerators: [
      { name: 'RED', value: 1 },
      { name: 'GREEN', value: 2 },
    ],
  }, // 8
  { kind: 'typedef', name: 'alias', target: 0 }, // 9
];

const INFO: CompiledDebugInfo = {
  lines: [{ pc: 0, file: 'main.ino', line: 1 }],
  functions: [
    {
      lowPc: 0x100,
      highPc: 0x120,
      frameBase: { kind: 'expr', bytes: [0x92, 0x20, 0x02] }, // SP + 2
      variables: [
        { name: 'a', type: 0, scope: 'local', location: { kind: 'expr', bytes: [0x8c, 0x05] } }, // breg28 +5
        { name: 'b', type: 1, scope: 'local', location: { kind: 'expr', bytes: [0x8c, 0x01] } },
        { name: 'c', type: 2, scope: 'local', constValue: 122 },
        {
          name: 'p',
          type: 3,
          scope: 'local',
          location: {
            kind: 'expr',
            bytes: [0x34, 0x9f, 0x93, 0x02, 0x35, 0x9f, 0x93, 0x02],
          }, // lit4, stack_value, piece 2, lit5, stack_value, piece 2
        },
        {
          name: 'arr',
          type: 4,
          scope: 'local',
          location: {
            kind: 'expr',
            bytes: [
              0x36, 0x9f, 0x93, 0x02,
              0x37, 0x9f, 0x93, 0x02,
              0x38, 0x9f, 0x93, 0x02,
            ],
          },
        },
        { name: 'ptr', type: 5, scope: 'local', location: { kind: 'expr', bytes: [0x0a, 0x00, 0x01, 0x9f] } }, // const2u 0x0100, stack_value
        { name: 'flag', type: 6, scope: 'local', constValue: 1 },
        { name: 'ratio', type: 7, scope: 'local', constValue: 0x3fc00000 },
        { name: 'color', type: 8, scope: 'local', constValue: 2 },
        { name: 'alias', type: 9, scope: 'local', constValue: 7 },
        {
          name: 'aliased',
          type: 9,
          scope: 'local',
          location: { kind: 'expr', bytes: [0x03, 0x00, 0x01, 0x80, 0x00] },
        },
        { name: 'minus', type: 0, scope: 'local', location: { kind: 'expr', bytes: [0x0a, 0xff, 0xff, 0x9f] } },
        {
          name: 'word',
          type: 1,
          scope: 'local',
          location: { kind: 'expr', bytes: [0x0c, 0x00, 0x00, 0x01, 0x00, 0x9f] },
        },
        {
          name: 'partial',
          type: 1,
          scope: 'local',
          location: { kind: 'expr', bytes: [0x32, 0x9f, 0x93, 0x02] },
        },
        { name: 'future', type: 0, scope: 'local', location: { kind: 'loclist', ranges: [{ begin: 0x110, end: 0x120, bytes: [0x8c, 0x05] }] } },
        { name: 'missing', type: 0, scope: 'local', location: { kind: 'expr', bytes: [0xf3, 0x01, 0x50] } },
        { name: 'bad', type: 0, scope: 'local', location: { kind: 'expr', bytes: [0x03, 0x00, 0x09, 0x80, 0x00] } },
        { name: 'stackVar', type: 0, scope: 'local', location: { kind: 'expr', bytes: [0x91, 0x05] } },
      ],
    },
  ],
  globals: [
    { name: 'gCount', type: 0, scope: 'global', location: { kind: 'expr', bytes: [0x03, 0x00, 0x01, 0x80, 0x00] } },
  ],
  types: TYPES,
};

function context() {
  const data = new Uint8Array(0x900);
  data[0x100] = 3;
  data[0x8f4] = 2;
  data[0x8fa] = 9;
  data[0x8f8] = 1;
  const registers = new Array<number>(32).fill(0);
  registers[24] = 4;
  registers[28] = 0xf3;
  registers[29] = 0x08;
  return { pc: 0x100, registers, sp: 0x8f3, data };
}

describe('readVariables', () => {
  it('reads registers, globals, constants and composites', () => {
    const values = new Map(
      readVariables(INFO, context()).map((variable) => [variable.name, variable.value]),
    );
    expect(values.get('a')).toBe('1');
    expect(values.get('b')).toBe('2');
    expect(values.get('c')).toBe("'z' (0x7a)");
    expect(values.get('p')).toBe('{x: 4, y: 5}');
    expect(values.get('arr')).toBe('{6, 7, 8}');
    expect(values.get('ptr')).toBe('0x0100');
    expect(values.get('flag')).toBe('true');
    expect(values.get('ratio')).toBe('1.5');
    expect(values.get('color')).toBe('GREEN (2)');
    expect(values.get('alias')).toBe('7');
    expect(values.get('aliased')).toBe('3');
    expect(values.get('minus')).toBe('-1');
    expect(values.get('word')).toBe('65536');
    expect(values.get('partial')).toBe('2…');
    expect(values.get('stackVar')).toBe('9');
    expect(values.get('gCount')).toBe('3');
  });

  it('reports unavailable locations as optimized out', () => {
    const values = new Map(
      readVariables(INFO, context()).map((variable) => [variable.name, variable.value]),
    );
    expect(values.get('future')).toBe('optimized out');
    expect(values.get('missing')).toBe('optimized out');
    expect(values.get('bad')).toBe('optimized out');
  });

  it('falls back to no variables outside every function', () => {
    const outside = { ...context(), pc: 0x200 };
    expect(readVariables(INFO, outside).map((variable) => variable.name)).toEqual(['gCount']);
  });
});
