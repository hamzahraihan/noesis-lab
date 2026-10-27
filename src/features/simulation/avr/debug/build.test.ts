import { describe, expect, it } from 'vitest';
import {
  DW_AT_byte_size,
  DW_AT_data_member_location,
  DW_AT_decl_file,
  DW_AT_decl_line,
  DW_AT_encoding,
  DW_AT_frame_base,
  DW_AT_high_pc,
  DW_AT_location,
  DW_AT_low_pc,
  DW_AT_name,
  DW_AT_type,
  DW_FORM_addr,
  DW_FORM_data1,
  DW_TAG_base_type,
  DW_TAG_compile_unit,
  DW_TAG_member,
  DW_TAG_pointer_type,
  DW_TAG_structure_type,
  DW_TAG_subprogram,
  DW_TAG_variable,
  type RawDebugDie,
  type RawDebugInfo,
  type RawDebugUnit,
  type RawDebugValue,
} from './dwarf-info';
import { buildDebugModel } from './build';
import type { DebugUnitMap } from './model';

function scalar(value: number, form = DW_FORM_data1): RawDebugValue {
  return { kind: 'scalar', value, form };
}

function block(bytes: number[]): RawDebugValue {
  return { kind: 'block', bytes: Uint8Array.from(bytes) };
}

function ref(value: number): RawDebugValue {
  return { kind: 'ref', value };
}

function die(
  offset: number,
  tag: number,
  attributes: Record<number, RawDebugValue>,
  children: RawDebugDie[] = [],
): RawDebugDie {
  return {
    offset,
    tag,
    attributes: new Map(
      Object.entries(attributes).map(([key, value]) => [Number(key), value] as const),
    ),
    children,
  };
}

const INT = 200;
const NODE = 300;
const NODE_PTR = 310;
const BASE = die(INT, DW_TAG_base_type, {
  [DW_AT_name]: { kind: 'string', value: 'int' },
  [DW_AT_byte_size]: scalar(2),
  [DW_AT_encoding]: scalar(5),
});
const A = die(110, DW_TAG_variable, {
  [DW_AT_name]: { kind: 'string', value: 'a' },
  [DW_AT_type]: ref(INT),
  [DW_AT_location]: block([0x8c, 0x05]),
  [DW_AT_decl_file]: scalar(1),
  [DW_AT_decl_line]: scalar(6),
});
const G = die(120, DW_TAG_variable, {
  [DW_AT_name]: { kind: 'string', value: 'gCount' },
  [DW_AT_type]: ref(INT),
  [DW_AT_location]: block([0x03, 0x00, 0x01, 0x80, 0x00]),
  [DW_AT_decl_file]: scalar(1),
  [DW_AT_decl_line]: scalar(2),
});
const SYSTEM = die(130, DW_TAG_variable, {
  [DW_AT_name]: { kind: 'string', value: '__malloc_margin' },
  [DW_AT_type]: ref(INT),
  [DW_AT_location]: block([0x03, 0x00, 0x02, 0x80, 0x00]),
  [DW_AT_decl_file]: scalar(3),
  [DW_AT_decl_line]: scalar(312),
});
const LOOP = die(
  100,
  DW_TAG_subprogram,
  {
    [DW_AT_name]: { kind: 'string', value: 'loop' },
    [DW_AT_low_pc]: scalar(0x100, DW_FORM_addr),
    [DW_AT_high_pc]: scalar(0x120, DW_FORM_addr),
    [DW_AT_frame_base]: block([0x92, 0x20, 0x02]),
    [DW_AT_decl_file]: scalar(1),
    [DW_AT_decl_line]: scalar(5),
  },
  [A],
);
const CU = die(0, DW_TAG_compile_unit, {}, [LOOP, G, SYSTEM, BASE]);
const UNIT: RawDebugUnit = {
  offset: 0,
  name: '/build/HorangFirmware.cpp',
  files: ['', 'HorangFirmware.cpp'],
  root: CU,
  dies: new Map([
    [0, CU],
    [100, LOOP],
    [110, A],
    [120, G],
    [130, SYSTEM],
    [200, BASE],
  ]),
};
const MAP: DebugUnitMap = {
  unit: 'HorangFirmware.cpp',
  lineMap: [
    { file: 'main.ino', line: 1 },
    { file: 'main.ino', line: 2 },
    { file: 'main.ino', line: 3 },
    { file: 'main.ino', line: 4 },
    { file: 'main.ino', line: 5 },
    { file: 'main.ino', line: 6 },
  ],
};

function raw(units: RawDebugUnit[], locLists = new Map()): RawDebugInfo {
  return { units, locLists };
}

describe('buildDebugModel', () => {
  it('keeps sketch declarations and drops header names', () => {
    const info = buildDebugModel([], raw([UNIT]), [MAP]);
    expect(info.functions).toHaveLength(1);
    expect(info.functions[0]?.lowPc).toBe(0x100);
    expect(info.functions[0]?.highPc).toBe(0x120);
    expect(info.functions[0]?.frameBase).toEqual({
      kind: 'expr',
      bytes: [0x92, 0x20, 0x02],
    });
    expect(info.functions[0]?.variables.map((variable) => variable.name)).toEqual(['a']);
    expect(info.globals.map((variable) => variable.name)).toEqual(['gCount']);
    expect(info.types[0]).toMatchObject({
      kind: 'base',
      name: 'int',
      byteSize: 2,
      encoding: 5,
    });
  });

  it('terminates a struct/pointer cycle', () => {
    const node = die(
      NODE,
      DW_TAG_structure_type,
      {
        [DW_AT_name]: { kind: 'string', value: 'Node' },
        [DW_AT_byte_size]: scalar(4),
      },
      [
        die(305, DW_TAG_member, {
          [DW_AT_name]: { kind: 'string', value: 'next' },
          [DW_AT_type]: ref(NODE_PTR),
          [DW_AT_data_member_location]: block([0x23, 0x02]),
        }),
      ],
    );
    const pointer = die(NODE_PTR, DW_TAG_pointer_type, {
      [DW_AT_byte_size]: scalar(2),
      [DW_AT_type]: ref(NODE),
    });
    const head = die(340, DW_TAG_variable, {
      [DW_AT_name]: { kind: 'string', value: 'head' },
      [DW_AT_type]: ref(NODE),
      [DW_AT_decl_file]: scalar(1),
      [DW_AT_decl_line]: scalar(2),
    });
    const cu = die(0, DW_TAG_compile_unit, {}, [head, node, pointer]);
    const unit = {
      ...UNIT,
      root: cu,
      dies: new Map<number, RawDebugDie>([
        [0, cu],
        [340, head],
        [300, node],
        [310, pointer],
      ]),
    };
    const info = buildDebugModel([], raw([unit]), [MAP]);
    expect(info.types).toHaveLength(2);
    expect(info.types[0]?.kind).toBe('struct');
    expect(info.types[0]?.members?.[0]?.type).toBe(1);
    expect(info.types[1]?.kind).toBe('pointer');
    expect(info.types[1]?.target).toBe(0);
  });

  it('caps the function list', () => {
    const functions = Array.from({ length: 201 }, (_, index) =>
      die(1000 + index, DW_TAG_subprogram, {
        [DW_AT_name]: { kind: 'string', value: `f${index}` },
        [DW_AT_low_pc]: scalar(index * 2, DW_FORM_addr),
        [DW_AT_high_pc]: scalar(index * 2 + 2, DW_FORM_addr),
        [DW_AT_decl_file]: scalar(1),
        [DW_AT_decl_line]: scalar(5),
      }),
    );
    const cu = die(0, DW_TAG_compile_unit, {}, [...functions, BASE]);
    const unit = {
      ...UNIT,
      root: cu,
      dies: new Map<number, RawDebugDie>([
        [0, cu],
        [INT, BASE],
        ...functions.map((fn) => [fn.offset, fn] as const),
      ]),
    };
    expect(buildDebugModel([], raw([unit]), [MAP]).functions).toHaveLength(200);
  });
});
