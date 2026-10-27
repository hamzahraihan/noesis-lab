import type {
  CompiledDebugInfo,
  DebugFunction,
  DebugLocation,
  DebugType,
  DebugTypeKind,
  DebugVariableSpec,
} from './model';

const MAX_FUNCTIONS = 200;
const MAX_VARIABLES = 500;
const MAX_GLOBALS = 500;
const MAX_TYPES = 256;
const MAX_RANGES = 64;
const MAX_EXPR = 64;

const TYPE_KINDS: ReadonlySet<string> = new Set([
  'base',
  'pointer',
  'reference',
  'array',
  'struct',
  'union',
  'enum',
  'typedef',
  'const',
  'volatile',
  'void',
  'unknown',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function octets(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_EXPR &&
    value.every((byte) => isNonNegativeInteger(byte) && byte <= 0xff)
  );
}

function parseLocation(value: unknown): DebugLocation | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'expr') {
    if (!octets(value.bytes)) return null;
    return { kind: 'expr', bytes: value.bytes };
  }
  if (value.kind !== 'loclist' || !Array.isArray(value.ranges)) return null;
  if (value.ranges.length > MAX_RANGES) return null;
  const ranges: { begin: number; end: number; bytes: readonly number[] }[] = [];
  for (const raw of value.ranges) {
    if (!isRecord(raw)) return null;
    if (!isNonNegativeInteger(raw.begin) || !isNonNegativeInteger(raw.end)) return null;
    if (raw.end < raw.begin || !octets(raw.bytes)) return null;
    ranges.push({ begin: raw.begin, end: raw.end, bytes: raw.bytes });
  }
  return { kind: 'loclist', ranges };
}

function parseVariable(
  value: unknown,
  scope: 'local' | 'global',
  typeCount: number,
): DebugVariableSpec | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== 'string' || value.name === '') return null;
  if (!isNonNegativeInteger(value.type) || value.type >= typeCount) return null;
  if (value.scope !== scope) return null;
  if (value.declLine !== undefined && !isNonNegativeInteger(value.declLine)) return null;
  if (
    value.constValue !== undefined &&
    (typeof value.constValue !== 'number' || !Number.isFinite(value.constValue))
  ) {
    return null;
  }
  let location: DebugLocation | undefined;
  if (value.location !== undefined) {
    const parsed = parseLocation(value.location);
    if (parsed === null) return null;
    location = parsed;
  }
  return {
    name: value.name,
    type: value.type,
    scope,
    ...(location === undefined ? {} : { location }),
    ...(value.constValue === undefined ? {} : { constValue: value.constValue }),
    ...(value.declLine === undefined ? {} : { declLine: value.declLine }),
  };
}

function parseVariables(
  value: unknown,
  scope: 'local' | 'global',
  typeCount: number,
  cap: number,
): DebugVariableSpec[] | null {
  if (!Array.isArray(value) || value.length > cap) return null;
  const out: DebugVariableSpec[] = [];
  for (const raw of value) {
    const parsed = parseVariable(raw, scope, typeCount);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function parseFunctions(value: unknown, typeCount: number): DebugFunction[] | null {
  if (!Array.isArray(value) || value.length > MAX_FUNCTIONS) return null;
  const out: DebugFunction[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    if (!isNonNegativeInteger(raw.lowPc) || !isNonNegativeInteger(raw.highPc)) return null;
    if (raw.highPc <= raw.lowPc) return null;
    const variables = parseVariables(raw.variables, 'local', typeCount, MAX_VARIABLES);
    if (variables === null) return null;
    let frameBase: DebugLocation | undefined;
    if (raw.frameBase !== undefined) {
      const parsed = parseLocation(raw.frameBase);
      if (parsed === null) return null;
      frameBase = parsed;
    }
    out.push({
      lowPc: raw.lowPc,
      highPc: raw.highPc,
      variables,
      ...(frameBase === undefined ? {} : { frameBase }),
    });
  }
  return out;
}

function parseType(value: unknown, typeCount: number): DebugType | null {
  if (!isRecord(value)) return null;
  if (typeof value.kind !== 'string' || !TYPE_KINDS.has(value.kind)) return null;
  if (value.name !== undefined && typeof value.name !== 'string') return null;
  if (value.byteSize !== undefined && !isNonNegativeInteger(value.byteSize)) return null;
  if (value.encoding !== undefined && !isNonNegativeInteger(value.encoding)) return null;
  if (value.count !== undefined && !isNonNegativeInteger(value.count)) return null;
  if (value.target !== undefined) {
    if (!isNonNegativeInteger(value.target) || value.target >= typeCount) return null;
  }
  let members;
  if (value.members !== undefined) {
    if (!Array.isArray(value.members) || value.members.length > 64) return null;
    members = [];
    for (const raw of value.members) {
      if (!isRecord(raw)) return null;
      if (typeof raw.name !== 'string' || raw.name === '') return null;
      if (!isNonNegativeInteger(raw.offset)) return null;
      if (!isNonNegativeInteger(raw.type) || raw.type >= typeCount) return null;
      members.push({ name: raw.name, offset: raw.offset, type: raw.type });
    }
  }
  let enumerators;
  if (value.enumerators !== undefined) {
    if (!Array.isArray(value.enumerators) || value.enumerators.length > 64) return null;
    enumerators = [];
    for (const raw of value.enumerators) {
      if (!isRecord(raw)) return null;
      if (typeof raw.name !== 'string' || raw.name === '') return null;
      if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return null;
      enumerators.push({ name: raw.name, value: raw.value });
    }
  }
  return {
    kind: value.kind as DebugTypeKind,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.byteSize === undefined ? {} : { byteSize: value.byteSize }),
    ...(value.encoding === undefined ? {} : { encoding: value.encoding }),
    ...(value.target === undefined ? {} : { target: value.target }),
    ...(value.count === undefined ? {} : { count: value.count }),
    ...(members === undefined ? {} : { members }),
    ...(enumerators === undefined ? {} : { enumerators }),
  };
}

function parseTypes(value: unknown): DebugType[] | null {
  if (!Array.isArray(value) || value.length > MAX_TYPES) return null;
  const out: DebugType[] = [];
  for (const raw of value) {
    const parsed = parseType(raw, value.length);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/** Validates a value that crossed the toolchain/sim-worker boundary. */
export function parseDebugInfo(value: unknown): CompiledDebugInfo | null {
  if (!isRecord(value) || !Array.isArray(value.lines)) return null;
  const rows = value.lines;
  const lines = [];
  for (const entry of rows) {
    if (!isRecord(entry)) return null;
    if (!isNonNegativeInteger(entry.pc)) return null;
    if (typeof entry.file !== 'string' || entry.file === '') return null;
    if (!isNonNegativeInteger(entry.line) || entry.line <= 0) return null;
    lines.push({ pc: entry.pc, file: entry.file, line: entry.line });
  }
  if (lines.length === 0) return null;
  const types = parseTypes(value.types ?? []);
  if (types === null) return null;
  const globals = parseVariables(value.globals ?? [], 'global', types.length, MAX_GLOBALS);
  if (globals === null) return null;
  const functions = parseFunctions(value.functions ?? [], types.length);
  if (functions === null) return null;
  return { lines, functions, globals, types };
}
