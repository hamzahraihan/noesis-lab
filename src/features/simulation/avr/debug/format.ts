import type { DebugType } from './model';

const DW_ATE_boolean = 0x02;
const DW_ATE_float = 0x04;
const DW_ATE_signed = 0x05;
const DW_ATE_signed_char = 0x06;
const DW_ATE_unsigned = 0x07;
const DW_ATE_unsigned_char = 0x08;

function hex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function readUnsigned(bytes: Uint8Array, size: number): number {
  const count = Math.min(size, bytes.length);
  let value = 0;
  for (let index = 0; index < count; index += 1) {
    value += (bytes[index] ?? 0) * 2 ** (8 * index);
  }
  return value;
}

function readSigned(bytes: Uint8Array, size: number): number {
  const count = Math.min(size, bytes.length);
  let value = readUnsigned(bytes, size);
  if (count > 0 && ((bytes[count - 1] ?? 0) & 0x80) !== 0) {
    value -= 2 ** (8 * count);
  }
  return value;
}

/** Unwraps typedef/const/volatile aliases to the type that holds the value. */
export function resolveType(
  typeIndex: number,
  types: readonly DebugType[],
): DebugType | undefined {
  const seen = new Set<number>();
  let index = typeIndex;
  for (;;) {
    const type = types[index];
    if (type === undefined) return undefined;
    if (
      (type.kind === 'typedef' || type.kind === 'const' || type.kind === 'volatile') &&
      type.target !== undefined &&
      !seen.has(index)
    ) {
      seen.add(index);
      index = type.target;
      continue;
    }
    return type;
  }
}

function charText(value: number): string | null {
  if (value >= 0x20 && value <= 0x7e) return String.fromCharCode(value);
  return null;
}

function formatBase(bytes: Uint8Array, type: DebugType, size: number): string {
  if (type.encoding === DW_ATE_boolean) {
    return readUnsigned(bytes, size) !== 0 ? 'true' : 'false';
  }
  if (type.encoding === DW_ATE_float) {
    if (bytes.length >= 8 && size >= 8) {
      const view = new DataView(new ArrayBuffer(8));
      bytes.subarray(0, 8).forEach((byte, index) => view.setUint8(index, byte));
      return String(view.getFloat64(0, true));
    }
    if (bytes.length >= 4) {
      const view = new DataView(new ArrayBuffer(4));
      bytes.subarray(0, 4).forEach((byte, index) => view.setUint8(index, byte));
      return String(view.getFloat32(0, true));
    }
    return hex(bytes);
  }
  if (type.name === 'char') {
    const value = readSigned(bytes, 1);
    const text = charText(value & 0xff);
    return text === null
      ? `0x${(value & 0xff).toString(16).padStart(2, '0')}`
      : `'${text}' (0x${(value & 0xff).toString(16).padStart(2, '0')})`;
  }
  if (type.encoding === DW_ATE_signed || type.encoding === DW_ATE_signed_char) {
    return String(readSigned(bytes, size));
  }
  if (type.encoding === DW_ATE_unsigned || type.encoding === DW_ATE_unsigned_char) {
    return String(readUnsigned(bytes, size));
  }
  return hex(bytes);
}

/** Formats a byte sequence according to a type table. */
export function formatValue(
  bytes: Uint8Array,
  typeIndex: number,
  types: readonly DebugType[],
): string {
  const type = resolveType(typeIndex, types);
  if (type === undefined) return hex(bytes);
  const size = type.byteSize ?? bytes.length;
  const suffix = bytes.length < size ? '…' : '';
  switch (type.kind) {
    case 'base':
    case 'unknown':
      return type.kind === 'base' ? `${formatBase(bytes, type, size)}${suffix}` : hex(bytes);
    case 'pointer':
    case 'reference':
      return `0x${readUnsigned(bytes, type.byteSize ?? 2)
        .toString(16)
        .padStart(4, '0')}`;
    case 'array': {
      const target = type.target === undefined ? undefined : resolveType(type.target, types);
      if (target === undefined) return hex(bytes);
      const elementSize = target.byteSize ?? (target.kind === 'pointer' ? 2 : 1);
      const count = Math.min(type.count ?? 0, 8);
      const values: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const start = index * elementSize;
        if (start >= bytes.length) break;
        values.push(
          formatValue(
            bytes.subarray(start, Math.min(start + elementSize, bytes.length)),
            type.target!,
            types,
          ),
        );
      }
      if (target.name === 'char' && bytes.length > 0) {
        let text = '';
        let printable = true;
        for (const byte of bytes) {
          if (byte === 0) break;
          if (byte < 0x20 || byte > 0x7e) {
            printable = false;
            break;
          }
          text += String.fromCharCode(byte);
        }
        if (printable && text !== '') return `"${text}"`;
      }
      const more = (type.count ?? 0) > values.length ? ', …' : '';
      return `{${values.join(', ')}${more}}`;
    }
    case 'struct':
    case 'union': {
      const members = type.members ?? [];
      const values = members.slice(0, 8).map((member) => {
        const memberType = resolveType(member.type, types);
        const memberSize = memberType?.byteSize ?? 1;
        const start = type.kind === 'union' ? 0 : member.offset;
        return `${member.name}: ${formatValue(
          bytes.subarray(start, Math.min(start + memberSize, bytes.length)),
          member.type,
          types,
        )}`;
      });
      return `{${values.join(', ')}${members.length > 8 ? ', …' : ''}}`;
    }
    case 'enum': {
      const underlying = type.target === undefined ? undefined : resolveType(type.target, types);
      const value = readUnsigned(bytes, underlying?.byteSize ?? type.byteSize ?? 2);
      const named = type.enumerators?.find((enumerator) => enumerator.value === value);
      return named === undefined ? String(value) : `${named.name} (${value})`;
    }
    case 'void':
      return 'void';
    default:
      return hex(bytes);
  }
}

/** Formats a DW_AT_const_value through the same type rules. */
export function formatConstant(
  value: number,
  typeIndex: number,
  types: readonly DebugType[],
): string {
  const type = resolveType(typeIndex, types);
  const size = type?.byteSize ?? 4;
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = Math.floor(value / 2 ** (8 * index)) & 0xff;
  }
  return formatValue(bytes, typeIndex, types);
}
