import { describe, expect, it } from 'vitest';
import {
  DW_AT_byte_size,
  DW_AT_decl_file,
  DW_AT_decl_line,
  DW_AT_encoding,
  DW_AT_frame_base,
  DW_AT_high_pc,
  DW_AT_location,
  DW_AT_low_pc,
  DW_AT_name,
  DW_AT_stmt_list,
  DW_AT_type,
  DW_FORM_addr,
  DW_FORM_block1,
  DW_FORM_data1,
  DW_FORM_data4,
  DW_FORM_ref4,
  DW_FORM_strp,
  DW_FORM_string,
  DW_TAG_base_type,
  DW_TAG_compile_unit,
  DW_TAG_subprogram,
  DW_TAG_variable,
  parseElfDebugInfo,
} from './dwarf-info';
import { cstr, dwarfLineTable, elfWithSections, u16, u32, uleb } from './test-elf';

const ABBREV = new Uint8Array([
  ...uleb(1), ...uleb(DW_TAG_compile_unit), 1,
  ...uleb(DW_AT_name), ...uleb(DW_FORM_strp),
  ...uleb(DW_AT_stmt_list), ...uleb(DW_FORM_data4),
  0, 0,
  ...uleb(2), ...uleb(DW_TAG_subprogram), 1,
  ...uleb(DW_AT_name), ...uleb(DW_FORM_string),
  ...uleb(DW_AT_low_pc), ...uleb(DW_FORM_addr),
  ...uleb(DW_AT_high_pc), ...uleb(DW_FORM_addr),
  ...uleb(DW_AT_frame_base), ...uleb(DW_FORM_block1),
  0, 0,
  ...uleb(3), ...uleb(DW_TAG_variable), 0,
  ...uleb(DW_AT_name), ...uleb(DW_FORM_string),
  ...uleb(DW_AT_type), ...uleb(DW_FORM_ref4),
  ...uleb(DW_AT_location), ...uleb(DW_FORM_block1),
  ...uleb(DW_AT_decl_file), ...uleb(DW_FORM_data1),
  ...uleb(DW_AT_decl_line), ...uleb(DW_FORM_data1),
  0, 0,
  ...uleb(4), ...uleb(DW_TAG_base_type), 0,
  ...uleb(DW_AT_name), ...uleb(DW_FORM_string),
  ...uleb(DW_AT_byte_size), ...uleb(DW_FORM_data1),
  ...uleb(DW_AT_encoding), ...uleb(DW_FORM_data1),
  0, 0,
  0,
]);

function debugInfo(): Uint8Array {
  const body = [
    ...uleb(1), // compile-unit DIE
    ...u32(0), // name strp offset patched to 0 below
    ...u32(0), // stmt_list: line table at 0
    ...uleb(2), ...cstr('loop'), ...u32(0x0100), ...u32(0x0120), 3, 0x92, 0x20, 0x02,
    ...uleb(3), ...cstr('a'), ...u32(50), 2, 0x8c, 0x05, 1, 6,
    ...uleb(4), ...cstr('int'), 2, 5,
    0, // end subprogram children
    0, // end CU children
  ];
  // The CU header is 11 bytes before `body`; the base-type DIE starts at
  // body offset 39, so the variable's ref4 points at absolute offset 50.
  return new Uint8Array([...u32(body.length + 7), ...u16(2), ...u32(0), 4, ...body]);
}

function elf(): Uint8Array {
  return elfWithSections([
    { name: '.debug_info', data: debugInfo() },
    { name: '.debug_abbrev', data: ABBREV },
    { name: '.debug_str', data: new Uint8Array(cstr('/build/HorangFirmware.cpp')) },
    { name: '.debug_line', data: dwarfLineTable() },
    {
      name: '.debug_loc',
      data: new Uint8Array([
        ...u32(0x0100), ...u32(0x0110), ...u16(2), 0x8c, 0x05,
        ...u32(0), ...u32(0),
      ]),
    },
  ]);
}

function scalar(value: unknown): number {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as { kind?: string }).kind !== 'scalar'
  ) {
    throw new Error('not a scalar');
  }
  return (value as { value: number }).value;
}

function block(value: unknown): readonly number[] {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as { kind?: string }).kind !== 'block'
  ) {
    throw new Error('not a block');
  }
  return Array.from((value as { bytes: Uint8Array }).bytes);
}

describe('parseElfDebugInfo', () => {
  it('reads a CU, its file table, a subprogram, a variable and a loclist', () => {
    const info = parseElfDebugInfo(elf());
    expect(info.units).toHaveLength(1);
    const unit = info.units[0]!;
    expect(unit.name).toBe('/build/HorangFirmware.cpp');
    expect(unit.files).toEqual(['', 'HorangFirmware.cpp']);
    expect(unit.root.children).toHaveLength(1);
    const sub = unit.root.children[0]!;
    expect(sub.tag).toBe(DW_TAG_subprogram);
    expect(scalar(sub.attributes.get(DW_AT_low_pc))).toBe(0x100);
    expect(scalar(sub.attributes.get(DW_AT_high_pc))).toBe(0x120);
    expect(block(sub.attributes.get(DW_AT_frame_base))).toEqual([0x92, 0x20, 0x02]);
    const variable = sub.children[0]!;
    expect(variable.tag).toBe(DW_TAG_variable);
    expect(variable.attributes.get(DW_AT_type)).toMatchObject({ kind: 'ref', value: 50 });
    expect(block(variable.attributes.get(DW_AT_location))).toEqual([0x8c, 0x05]);
    expect(scalar(variable.attributes.get(DW_AT_decl_file))).toBe(1);
    expect(scalar(variable.attributes.get(DW_AT_decl_line))).toBe(6);
    expect(info.locLists.get(0)).toEqual([
      { begin: 0x100, end: 0x110, bytes: new Uint8Array([0x8c, 0x05]) },
    ]);
  });

  it('returns an empty result for an empty or truncated ELF', () => {
    expect(parseElfDebugInfo(new Uint8Array(0))).toEqual({
      units: [],
      locLists: new Map(),
    });
    const truncated = elf().subarray(0, 60);
    expect(parseElfDebugInfo(truncated)).toEqual({ units: [], locLists: new Map() });
  });
});
