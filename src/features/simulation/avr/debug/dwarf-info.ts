import { Reader, lineFilesAt, sectionsOf } from './dwarf';

export const DW_TAG_array_type = 0x01;
export const DW_TAG_class_type = 0x02;
export const DW_TAG_enumeration_type = 0x04;
export const DW_TAG_formal_parameter = 0x05;
export const DW_TAG_lexical_block = 0x0b;
export const DW_TAG_member = 0x0d;
export const DW_TAG_pointer_type = 0x0f;
export const DW_TAG_reference_type = 0x10;
export const DW_TAG_compile_unit = 0x11;
export const DW_TAG_structure_type = 0x13;
export const DW_TAG_typedef = 0x16;
export const DW_TAG_union_type = 0x17;
export const DW_TAG_inlined_subroutine = 0x1d;
export const DW_TAG_subrange_type = 0x21;
export const DW_TAG_base_type = 0x24;
export const DW_TAG_const_type = 0x26;
export const DW_TAG_enumerator = 0x28;
export const DW_TAG_subprogram = 0x2e;
export const DW_TAG_variable = 0x34;
export const DW_TAG_volatile_type = 0x35;
export const DW_TAG_unspecified_type = 0x3b;

export const DW_AT_location = 0x02;
export const DW_AT_name = 0x03;
export const DW_AT_byte_size = 0x0b;
export const DW_AT_low_pc = 0x11;
export const DW_AT_high_pc = 0x12;
export const DW_AT_const_value = 0x1c;
export const DW_AT_upper_bound = 0x2f;
export const DW_AT_count = 0x37;
export const DW_AT_data_member_location = 0x38;
export const DW_AT_decl_file = 0x3a;
export const DW_AT_decl_line = 0x3b;
export const DW_AT_declaration = 0x3c;
export const DW_AT_encoding = 0x3e;
export const DW_AT_frame_base = 0x40;
export const DW_AT_type = 0x49;
export const DW_AT_stmt_list = 0x10;

export const DW_FORM_addr = 0x01;
export const DW_FORM_block2 = 0x03;
export const DW_FORM_block4 = 0x04;
export const DW_FORM_data2 = 0x05;
export const DW_FORM_data4 = 0x06;
export const DW_FORM_data8 = 0x07;
export const DW_FORM_string = 0x08;
export const DW_FORM_block = 0x09;
export const DW_FORM_block1 = 0x0a;
export const DW_FORM_data1 = 0x0b;
export const DW_FORM_flag = 0x0c;
export const DW_FORM_sdata = 0x0d;
export const DW_FORM_strp = 0x0e;
export const DW_FORM_udata = 0x0f;
export const DW_FORM_ref_addr = 0x10;
export const DW_FORM_ref1 = 0x11;
export const DW_FORM_ref2 = 0x12;
export const DW_FORM_ref4 = 0x13;
export const DW_FORM_ref8 = 0x14;
export const DW_FORM_ref_udata = 0x15;
export const DW_FORM_indirect = 0x16;
export const DW_FORM_sec_offset = 0x17;
export const DW_FORM_exprloc = 0x18;
export const DW_FORM_flag_present = 0x19;
export const DW_FORM_ref_sig8 = 0x20;
export const DW_FORM_implicit_const = 0x21;

export type RawDebugValue =
  | { readonly kind: 'scalar'; readonly value: number; readonly form: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'block'; readonly bytes: Uint8Array }
  | { readonly kind: 'ref'; readonly value: number };

export interface RawDebugDie {
  readonly offset: number;
  readonly tag: number;
  readonly attributes: ReadonlyMap<number, RawDebugValue>;
  readonly children: readonly RawDebugDie[];
}

export interface RawDebugRange {
  readonly begin: number;
  readonly end: number;
  readonly bytes: Uint8Array;
}

export interface RawDebugUnit {
  /** Offset of the CU header (its length field). */
  readonly offset: number;
  readonly name: string;
  /** Line-table file names, 1-based, index 0 empty. */
  readonly files: readonly string[];
  readonly root: RawDebugDie;
  readonly dies: ReadonlyMap<number, RawDebugDie>;
}

export interface RawDebugInfo {
  readonly units: readonly RawDebugUnit[];
  readonly locLists: ReadonlyMap<number, readonly RawDebugRange[]>;
}

interface AbbrevAttribute {
  readonly name: number;
  readonly form: number;
  readonly implicit?: number;
}

interface Abbrev {
  readonly tag: number;
  readonly children: boolean;
  readonly attributes: readonly AbbrevAttribute[];
}

type AbbrevTable = ReadonlyMap<number, Abbrev>;

function readBytes(reader: Reader, size: number): Uint8Array {
  reader.require(size);
  const bytes = reader.bytes.slice(reader.offset, reader.offset + size);
  reader.offset += size;
  return bytes;
}

function readCString(strings: Uint8Array, offset: number): string {
  if (offset < 0 || offset >= strings.length) return '';
  try {
    return new Reader(strings, strings.length, offset).string();
  } catch {
    return '';
  }
}

function parseAbbrevTable(bytes: Uint8Array, offset: number): AbbrevTable {
  const reader = new Reader(bytes, bytes.length, offset);
  const table = new Map<number, Abbrev>();
  while (reader.remaining > 0) {
    const code = reader.uleb();
    if (code === 0) break;
    const tag = reader.uleb();
    const children = reader.u8() !== 0;
    const attributes: AbbrevAttribute[] = [];
    for (;;) {
      const name = reader.uleb();
      const form = reader.uleb();
      if (name === 0 && form === 0) break;
      const implicit = form === DW_FORM_implicit_const ? reader.sleb() : undefined;
      attributes.push({ name, form, ...(implicit === undefined ? {} : { implicit }) });
    }
    table.set(code, { tag, children, attributes });
  }
  return table;
}

function readForm(
  reader: Reader,
  form: number,
  strings: Uint8Array,
  cuStart: number,
  implicit?: number,
  depth = 0,
): RawDebugValue | undefined {
  if (depth > 8) throw new RangeError('DWARF form nesting is too deep');
  switch (form) {
    case DW_FORM_addr:
      return { kind: 'scalar', value: reader.u32(), form };
    case DW_FORM_block2:
      return { kind: 'block', bytes: readBytes(reader, reader.u16()) };
    case DW_FORM_block4:
      return { kind: 'block', bytes: readBytes(reader, reader.u32()) };
    case DW_FORM_block:
      return { kind: 'block', bytes: readBytes(reader, reader.uleb()) };
    case DW_FORM_block1:
      return { kind: 'block', bytes: readBytes(reader, reader.u8()) };
    case DW_FORM_exprloc:
      return { kind: 'block', bytes: readBytes(reader, reader.uleb()) };
    case DW_FORM_data1:
      return { kind: 'scalar', value: reader.u8(), form };
    case DW_FORM_data2:
      return { kind: 'scalar', value: reader.u16(), form };
    case DW_FORM_data4:
      return { kind: 'scalar', value: reader.u32(), form };
    case DW_FORM_data8:
      return { kind: 'scalar', value: reader.u64(), form };
    case DW_FORM_sdata:
      return { kind: 'scalar', value: reader.sleb(), form };
    case DW_FORM_udata:
      return { kind: 'scalar', value: reader.uleb(), form };
    case DW_FORM_string:
      return { kind: 'string', value: reader.string() };
    case DW_FORM_strp:
      return { kind: 'string', value: readCString(strings, reader.u32()) };
    case DW_FORM_flag:
      return { kind: 'scalar', value: reader.u8(), form };
    case DW_FORM_flag_present:
      return { kind: 'scalar', value: 1, form };
    case DW_FORM_ref1:
      return { kind: 'ref', value: cuStart + reader.u8() };
    case DW_FORM_ref2:
      return { kind: 'ref', value: cuStart + reader.u16() };
    case DW_FORM_ref4:
      return { kind: 'ref', value: cuStart + reader.u32() };
    case DW_FORM_ref8:
      return { kind: 'ref', value: cuStart + reader.u64() };
    case DW_FORM_ref_udata:
      return { kind: 'ref', value: cuStart + reader.uleb() };
    case DW_FORM_ref_addr:
      return { kind: 'ref', value: reader.u32() };
    case DW_FORM_sec_offset:
      return { kind: 'scalar', value: reader.u32(), form };
    case DW_FORM_indirect: {
      const actual = reader.uleb();
      return readForm(reader, actual, strings, cuStart, undefined, depth + 1);
    }
    case DW_FORM_implicit_const:
      return { kind: 'scalar', value: implicit ?? 0, form };
    case DW_FORM_ref_sig8:
      reader.skip(8);
      return undefined;
    default:
      throw new RangeError(`unsupported DWARF form 0x${form.toString(16)}`);
  }
}

function parseDie(
  reader: Reader,
  table: AbbrevTable,
  strings: Uint8Array,
  cuStart: number,
  dies: Map<number, RawDebugDie>,
  depth = 0,
): RawDebugDie | null {
  if (depth > 64) throw new RangeError('DWARF DIE nesting is too deep');
  const offset = reader.offset;
  const code = reader.uleb();
  if (code === 0) return null;
  const abbrev = table.get(code);
  if (abbrev === undefined) throw new RangeError(`unknown DWARF abbreviation ${code}`);
  const attributes = new Map<number, RawDebugValue>();
  for (const attribute of abbrev.attributes) {
    const value = readForm(
      reader,
      attribute.form,
      strings,
      cuStart,
      attribute.implicit,
    );
    if (value !== undefined) attributes.set(attribute.name, value);
  }
  const children: RawDebugDie[] = [];
  if (abbrev.children) {
    for (;;) {
      const child = parseDie(reader, table, strings, cuStart, dies, depth + 1);
      if (child === null) break;
      children.push(child);
    }
  }
  const die: RawDebugDie = { offset, tag: abbrev.tag, attributes, children };
  dies.set(offset, die);
  return die;
}

function parseLocationLists(bytes: Uint8Array): Map<number, RawDebugRange[]> {
  const reader = new Reader(bytes, bytes.length);
  const lists = new Map<number, RawDebugRange[]>();
  let listStart = -1;
  let ranges: RawDebugRange[] = [];
  let base: number | null = null;
  while (reader.remaining >= 8) {
    if (listStart < 0) listStart = reader.offset;
    const begin = reader.u32();
    const end = reader.u32();
    if (begin === 0 && end === 0) {
      lists.set(listStart, ranges);
      listStart = -1;
      ranges = [];
      base = null;
      continue;
    }
    if (begin === 0xffffffff) {
      base = end;
      continue;
    }
    const length = reader.u16();
    const expr = readBytes(reader, length);
    if (length > 0) {
      ranges.push({
        begin: base === null ? begin : begin + base,
        end: base === null ? end : end + base,
        bytes: expr,
      });
    }
  }
  if (listStart >= 0) lists.set(listStart, ranges);
  return lists;
}

function parseUnit(
  info: Uint8Array,
  start: number,
  abbrev: Uint8Array,
  strings: Uint8Array,
  line: Uint8Array | undefined,
  cache: Map<number, AbbrevTable>,
): RawDebugUnit | null {
  const reader = new Reader(info, info.length, start);
  const length = reader.u32();
  if (length === 0xffffffff) throw new RangeError('64-bit DWARF is not supported');
  const unitEnd = reader.offset + length;
  if (unitEnd > info.length) throw new RangeError('DWARF unit is truncated');
  const version = reader.u16();
  if (version < 2 || version > 4) {
    reader.offset = unitEnd;
    return null;
  }
  const abbrevOffset = reader.u32();
  const addressSize = reader.u8();
  if (addressSize !== 4) {
    reader.offset = unitEnd;
    return null;
  }
  let table = cache.get(abbrevOffset);
  if (table === undefined) {
    table = parseAbbrevTable(abbrev, abbrevOffset);
    cache.set(abbrevOffset, table);
  }
  const cuReader = new Reader(info, unitEnd, reader.offset);
  const dies = new Map<number, RawDebugDie>();
  let root: RawDebugDie | null = null;
  try {
    root = parseDie(cuReader, table, strings, start, dies);
  } catch {
    reader.offset = unitEnd;
    return null;
  }
  reader.offset = unitEnd;
  if (root === null || root.tag !== DW_TAG_compile_unit) return null;
  const nameValue = root.attributes.get(DW_AT_name);
  const name = nameValue?.kind === 'string' ? nameValue.value : '';
  const stmtValue = root.attributes.get(DW_AT_stmt_list);
  const stmt = stmtValue?.kind === 'scalar' ? stmtValue.value : undefined;
  const files =
    stmt !== undefined && line !== undefined ? lineFilesAt(line, stmt) : [];
  return { offset: start, name, files, root, dies };
}

/**
 * Parses the `.debug_info` half of an ELF image. A malformed section is
 * ignored rather than failing a compile; each CU is parsed independently.
 */
export function parseElfDebugInfo(elf: Uint8Array): RawDebugInfo {
  try {
    const sections = sectionsOf(elf);
    const info = sections.get('.debug_info');
    const abbrev = sections.get('.debug_abbrev');
    const strings = sections.get('.debug_str');
    if (info === undefined || abbrev === undefined || strings === undefined) {
      return { units: [], locLists: new Map() };
    }
    const line = sections.get('.debug_line');
    const loc = sections.get('.debug_loc');
    const locLists = loc === undefined ? new Map() : parseLocationLists(loc);
    const cache = new Map<number, AbbrevTable>();
    const units: RawDebugUnit[] = [];
    const reader = new Reader(info, info.length);
    while (reader.remaining >= 11) {
      const start = reader.offset;
      const header = new Reader(info, info.length, start);
      const unitLength = header.u32();
      const next = start + 4 + unitLength;
      try {
        const unit = parseUnit(info, start, abbrev, strings, line, cache);
        if (unit !== null) units.push(unit);
      } catch {
        break;
      }
      if (next <= start || next > info.length) break;
      reader.offset = next;
    }
    return { units, locLists };
  } catch {
    return { units: [], locLists: new Map() };
  }
}
