import { parseElfDebugLines, type RawDebugLine } from './dwarf';
import {
  DW_AT_byte_size,
  DW_AT_const_value,
  DW_AT_count,
  DW_AT_data_member_location,
  DW_AT_decl_file,
  DW_AT_decl_line,
  DW_AT_declaration,
  DW_AT_encoding,
  DW_AT_frame_base,
  DW_AT_high_pc,
  DW_AT_location,
  DW_AT_low_pc,
  DW_AT_name,
  DW_AT_type,
  DW_AT_upper_bound,
  DW_FORM_addr,
  DW_TAG_array_type,
  DW_TAG_base_type,
  DW_TAG_class_type,
  DW_TAG_const_type,
  DW_TAG_enumeration_type,
  DW_TAG_enumerator,
  DW_TAG_formal_parameter,
  DW_TAG_inlined_subroutine,
  DW_TAG_lexical_block,
  DW_TAG_member,
  DW_TAG_pointer_type,
  DW_TAG_reference_type,
  DW_TAG_structure_type,
  DW_TAG_subprogram,
  DW_TAG_subrange_type,
  DW_TAG_typedef,
  DW_TAG_union_type,
  DW_TAG_variable,
  DW_TAG_volatile_type,
  type RawDebugDie,
  type RawDebugInfo,
  type RawDebugUnit,
  type RawDebugValue,
  parseElfDebugInfo,
} from './dwarf-info';
import { buildDebugLines } from './lines';
import type {
  CompiledDebugInfo,
  DebugFunction,
  DebugLocation,
  DebugType,
  DebugVariableSpec,
  DebugUnitMap,
} from './model';

const MAX_FUNCTIONS = 200;
const MAX_VARIABLES = 500;
const MAX_GLOBALS = 500;
const MAX_TYPES = 256;

interface BuildContext {
  readonly raw: RawDebugInfo;
  readonly unit: DebugUnitMap;
  readonly cu: RawDebugUnit;
  readonly types: DebugType[];
  readonly typeIds: Map<number, number>;
}

function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash < 0 ? path : path.slice(slash + 1);
}

function scalarAttr(die: RawDebugDie, name: number): number | undefined {
  const value = die.attributes.get(name);
  return value?.kind === 'scalar' ? value.value : undefined;
}

function stringAttr(die: RawDebugDie, name: number): string | undefined {
  const value = die.attributes.get(name);
  return value?.kind === 'string' ? value.value : undefined;
}

function refAttr(die: RawDebugDie, name: number): number | undefined {
  const value = die.attributes.get(name);
  return value?.kind === 'ref' ? value.value : undefined;
}

function locationFrom(
  raw: RawDebugInfo,
  value: RawDebugValue | undefined,
): DebugLocation | undefined {
  if (value === undefined) return undefined;
  if (value.kind === 'block') {
    return { kind: 'expr', bytes: Array.from(value.bytes) };
  }
  if (value.kind !== 'scalar') return undefined;
  const ranges = raw.locLists.get(value.value);
  if (ranges === undefined || ranges.length === 0) return undefined;
  return {
    kind: 'loclist',
    ranges: ranges.map((range) => ({
      begin: range.begin,
      end: range.end,
      bytes: Array.from(range.bytes),
    })),
  };
}

function memberOffset(die: RawDebugDie): number {
  const value = die.attributes.get(DW_AT_data_member_location);
  if (value === undefined) return 0;
  if (value.kind === 'scalar') return value.value;
  if (value.kind !== 'block' || value.bytes.length < 2) return 0;
  if (value.bytes[0] !== 0x23) return 0;
  let offset = 0;
  let shift = 0;
  for (const byte of value.bytes.subarray(1)) {
    offset += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return offset;
}

function typeIndex(ctx: BuildContext, offset: number | undefined): number | undefined {
  if (offset === undefined) return undefined;
  const existing = ctx.typeIds.get(offset);
  if (existing !== undefined) return existing;
  if (ctx.types.length >= MAX_TYPES) return undefined;
  const die = ctx.cu.dies.get(offset);
  if (die === undefined) return undefined;
  const index = ctx.types.length;
  ctx.typeIds.set(offset, index);
  ctx.types.push({ kind: 'unknown' });
  ctx.types[index] = buildType(ctx, die);
  return index;
}

function buildType(ctx: BuildContext, die: RawDebugDie): DebugType {
  const name = stringAttr(die, DW_AT_name);
  const byteSize = scalarAttr(die, DW_AT_byte_size);
  const type = refAttr(die, DW_AT_type);
  switch (die.tag) {
    case DW_TAG_base_type: {
      const encoding = scalarAttr(die, DW_AT_encoding);
      return {
        kind: 'base',
        ...(name === undefined ? {} : { name }),
        ...(byteSize === undefined ? {} : { byteSize }),
        ...(encoding === undefined ? {} : { encoding }),
      };
    }
    case DW_TAG_typedef:
      return {
        kind: 'typedef',
        ...(name === undefined ? {} : { name }),
        target: typeIndex(ctx, type),
      };
    case DW_TAG_const_type:
      return { kind: 'const', target: typeIndex(ctx, type) };
    case DW_TAG_volatile_type:
      return { kind: 'volatile', target: typeIndex(ctx, type) };
    case DW_TAG_pointer_type:
      return {
        kind: 'pointer',
        byteSize: byteSize ?? 2,
        target: typeIndex(ctx, type),
      };
    case DW_TAG_reference_type:
      return {
        kind: 'reference',
        byteSize: byteSize ?? 2,
        target: typeIndex(ctx, type),
      };
    case DW_TAG_array_type: {
      const subrange = die.children.find((child) => child.tag === DW_TAG_subrange_type);
      const upper = subrange === undefined ? undefined : scalarAttr(subrange, DW_AT_upper_bound);
      const explicit = subrange === undefined ? undefined : scalarAttr(subrange, DW_AT_count);
      const count = explicit ?? (upper === undefined ? 0 : upper + 1);
      const target = typeIndex(ctx, type);
      const elementSize = target === undefined ? undefined : ctx.types[target]?.byteSize;
      const computedSize =
        byteSize ?? (elementSize === undefined ? undefined : elementSize * count);
      return {
        kind: 'array',
        ...(computedSize === undefined ? {} : { byteSize: computedSize }),
        target,
        count,
      };
    }
    case DW_TAG_structure_type:
    case DW_TAG_class_type:
    case DW_TAG_union_type: {
      const members = [];
      for (const child of die.children) {
        if (child.tag !== DW_TAG_member) continue;
        const memberName = stringAttr(child, DW_AT_name);
        if (memberName === undefined) continue;
        const memberType = typeIndex(ctx, refAttr(child, DW_AT_type));
        if (memberType === undefined) continue;
        members.push({
          name: memberName,
          offset: die.tag === DW_TAG_union_type ? 0 : memberOffset(child),
          type: memberType,
        });
      }
      return {
        kind: die.tag === DW_TAG_union_type ? 'union' : 'struct',
        ...(name === undefined ? {} : { name }),
        ...(byteSize === undefined ? {} : { byteSize }),
        members,
      };
    }
    case DW_TAG_enumeration_type: {
      const enumerators = [];
      for (const child of die.children) {
        if (child.tag !== DW_TAG_enumerator) continue;
        const enumeratorName = stringAttr(child, DW_AT_name);
        const value = scalarAttr(child, DW_AT_const_value);
        if (enumeratorName === undefined || value === undefined) continue;
        enumerators.push({ name: enumeratorName, value });
      }
      const target = typeIndex(ctx, type);
      return {
        kind: 'enum',
        ...(name === undefined ? {} : { name }),
        byteSize: byteSize ?? 2,
        ...(target === undefined ? {} : { target }),
        enumerators,
      };
    }
    default:
      return { kind: 'unknown', ...(name === undefined ? {} : { name }) };
  }
}

function declarationOrigin(ctx: BuildContext, die: RawDebugDie): { line: number } | null {
  const declFile = scalarAttr(die, DW_AT_decl_file);
  const declLine = scalarAttr(die, DW_AT_decl_line);
  if (declFile === undefined || declLine === undefined) return null;
  const file = ctx.cu.files[declFile];
  if (file === undefined || file === '') return null;
  if (baseName(file).toLowerCase() !== baseName(ctx.unit.unit).toLowerCase()) return null;
  const origin = ctx.unit.lineMap[declLine - 1];
  if (
    origin === undefined ||
    origin.file === '' ||
    origin.file === '<packager>' ||
    origin.line <= 0
  ) {
    return null;
  }
  return { line: origin.line };
}

function variableSpec(
  ctx: BuildContext,
  die: RawDebugDie,
  scope: 'local' | 'global',
): DebugVariableSpec | null {
  if (scalarAttr(die, DW_AT_declaration) === 1) return null;
  const name = stringAttr(die, DW_AT_name);
  if (name === undefined || name === '') return null;
  const type = typeIndex(ctx, refAttr(die, DW_AT_type));
  if (type === undefined) return null;
  const origin = declarationOrigin(ctx, die);
  if (origin === null) return null;
  const location = locationFrom(ctx.raw, die.attributes.get(DW_AT_location));
  const constValue = scalarAttr(die, DW_AT_const_value);
  return {
    name,
    type,
    scope,
    ...(location === undefined ? {} : { location }),
    ...(constValue === undefined ? {} : { constValue }),
    declLine: origin.line,
  };
}

function collectVariables(
  ctx: BuildContext,
  die: RawDebugDie,
  out: DebugVariableSpec[],
  depth = 0,
): void {
  if (depth > 8 || out.length >= MAX_VARIABLES) return;
  for (const child of die.children) {
    if (child.tag === DW_TAG_variable || child.tag === DW_TAG_formal_parameter) {
      const spec = variableSpec(ctx, child, 'local');
      if (spec !== null) out.push(spec);
    } else if (child.tag === DW_TAG_lexical_block || child.tag === DW_TAG_inlined_subroutine) {
      collectVariables(ctx, child, out, depth + 1);
    }
  }
}

function buildFunction(ctx: BuildContext, die: RawDebugDie): DebugFunction | null {
  if (declarationOrigin(ctx, die) === null) return null;
  const lowPc = scalarAttr(die, DW_AT_low_pc);
  const highValue = die.attributes.get(DW_AT_high_pc);
  if (lowPc === undefined || highValue?.kind !== 'scalar') return null;
  const highPc = highValue.form === DW_FORM_addr ? highValue.value : lowPc + highValue.value;
  if (highPc <= lowPc) return null;
  const variables: DebugVariableSpec[] = [];
  collectVariables(ctx, die, variables);
  const frameBase = locationFrom(ctx.raw, die.attributes.get(DW_AT_frame_base));
  return {
    lowPc,
    highPc,
    ...(frameBase === undefined ? {} : { frameBase }),
    variables,
  };
}

/** Builds the compact model from already-parsed DWARF. */
export function buildDebugModel(
  rawLines: readonly RawDebugLine[],
  raw: RawDebugInfo,
  units: readonly DebugUnitMap[],
): CompiledDebugInfo {
  const lines = buildDebugLines(rawLines, units);
  const maps = new Map<string, DebugUnitMap>();
  for (const unit of units) maps.set(baseName(unit.unit).toLowerCase(), unit);
  const functions: DebugFunction[] = [];
  const globals: DebugVariableSpec[] = [];
  const types: DebugType[] = [];
  const typeIds = new Map<number, number>();
  for (const cu of raw.units) {
    const unit = maps.get(baseName(cu.name).toLowerCase());
    if (unit === undefined) continue;
    const ctx: BuildContext = { raw, unit, cu, types, typeIds };
    for (const die of cu.root.children) {
      if (die.tag === DW_TAG_subprogram) {
        if (functions.length >= MAX_FUNCTIONS) break;
        const fn = buildFunction(ctx, die);
        if (fn !== null) functions.push(fn);
      } else if (die.tag === DW_TAG_variable) {
        if (globals.length >= MAX_GLOBALS) continue;
        const spec = variableSpec(ctx, die, 'global');
        if (spec !== null) globals.push(spec);
      }
    }
  }
  functions.sort((a, b) => a.lowPc - b.lowPc);
  globals.sort((a, b) => (a.declLine ?? 0) - (b.declLine ?? 0) || a.name.localeCompare(b.name));
  return { lines, functions, globals, types };
}

/** Parses the ELF's line tables and info, then builds the compact model. */
export function buildCompiledDebug(
  elf: Uint8Array,
  units: readonly DebugUnitMap[],
): CompiledDebugInfo {
  try {
    return buildDebugModel(parseElfDebugLines(elf), parseElfDebugInfo(elf), units);
  } catch {
    return { lines: buildDebugLines(parseElfDebugLines(elf), units), functions: [], globals: [], types: [] };
  }
}
