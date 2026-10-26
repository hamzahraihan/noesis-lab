/**
 * Minimal ELF32 + DWARF line-table reader for the AVR toolchain.
 *
 * The bundled cc1plus/avr-as/avr-ld can emit DWARF, but the package exposes no
 * objdump/readelf, so the bench reads the two pieces it needs itself: the
 * section table of the linked ELF and the `.debug_line` state machine. File
 * paths are matched by basename later; the compiler's virtual `/build` prefix
 * is irrelevant to the sketch tabs.
 */

export interface RawDebugLine {
  /** Byte address in flash, as DWARF records it. */
  readonly address: number;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly endSequence: boolean;
}

function u16(bytes: Uint8Array, at: number): number {
  if (at < 0 || at + 2 > bytes.length) throw new RangeError('ELF read out of bounds');
  return bytes[at]! | (bytes[at + 1]! << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  if (at < 0 || at + 4 > bytes.length) throw new RangeError('ELF read out of bounds');
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

function cString(bytes: Uint8Array, at: number): string {
  let end = at;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return new TextDecoder().decode(bytes.subarray(at, end));
}

function sectionsOf(elf: Uint8Array): ReadonlyMap<string, Uint8Array> {
  if (elf.length < 52) throw new RangeError('ELF is truncated');
  if (
    elf[0] !== 0x7f ||
    elf[1] !== 0x45 ||
    elf[2] !== 0x4c ||
    elf[3] !== 0x46 ||
    elf[4] !== 1 ||
    elf[5] !== 1
  ) {
    throw new RangeError('not a little-endian ELF32 file');
  }
  const sectionOffset = u32(elf, 32);
  const sectionSize = u16(elf, 46);
  const sectionCount = u16(elf, 48);
  const nameIndex = u16(elf, 50);
  if (sectionOffset === 0 || sectionCount === 0 || nameIndex >= sectionCount) {
    return new Map();
  }
  if (sectionSize < 40) throw new RangeError('ELF section header is too small');
  const sectionAt = (index: number): number => sectionOffset + index * sectionSize;
  const nameHeader = sectionAt(nameIndex);
  const nameOffset = u32(elf, nameHeader + 16);
  const nameLength = u32(elf, nameHeader + 20);
  if (nameOffset + nameLength > elf.length) throw new RangeError('ELF section names are truncated');
  const names = elf.subarray(nameOffset, nameOffset + nameLength);

  const byName = new Map<string, Uint8Array>();
  for (let index = 1; index < sectionCount; index += 1) {
    const header = sectionAt(index);
    const nameAt = u32(elf, header);
    const name = cString(names, nameAt);
    const at = u32(elf, header + 16);
    const size = u32(elf, header + 20);
    if (at + size > elf.length) continue;
    // SHT_NOBITS has no bytes in the file; .debug_* is always PROGBITS.
    if (u32(elf, header + 4) === 8) continue;
    byName.set(name, elf.subarray(at, at + size));
  }
  return byName;
}

class Reader {
  readonly bytes: Uint8Array;
  readonly end: number;
  offset: number;

  constructor(bytes: Uint8Array, end: number, offset = 0) {
    this.bytes = bytes;
    this.end = end;
    this.offset = offset;
  }

  get remaining(): number {
    return this.end - this.offset;
  }

  require(size: number): void {
    if (size < 0 || this.offset + size > this.end) throw new RangeError('DWARF is truncated');
  }

  u8(): number {
    this.require(1);
    return this.bytes[this.offset++]!;
  }

  i8(): number {
    const value = this.u8();
    return value < 0x80 ? value : value - 0x100;
  }

  u16(): number {
    this.require(2);
    const value = this.bytes[this.offset]! | (this.bytes[this.offset + 1]! << 8);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.require(4);
    const value = u32(this.bytes, this.offset);
    this.offset += 4;
    return value;
  }

  u64(): number {
    this.require(8);
    const low = u32(this.bytes, this.offset);
    const high = u32(this.bytes, this.offset + 4);
    this.offset += 8;
    return high * 0x1_0000_0000 + low;
  }

  offsetValue(size: number): number {
    return size === 8 ? this.u64() : this.u32();
  }

  uleb(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
      if (shift > 53) throw new RangeError('DWARF ULEB is too large');
    }
  }

  sleb(): number {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.u8();
      value |= (byte & 0x7f) << shift;
      shift += 7;
      if (shift > 35) throw new RangeError('DWARF SLEB is too large');
    } while ((byte & 0x80) !== 0);
    if (shift < 32 && (byte & 0x40) !== 0) value |= -1 << shift;
    return value;
  }

  string(): string {
    const start = this.offset;
    while (this.offset < this.end && this.bytes[this.offset] !== 0) this.offset += 1;
    if (this.offset >= this.end) throw new RangeError('DWARF string is unterminated');
    const value = new TextDecoder().decode(this.bytes.subarray(start, this.offset));
    this.offset += 1;
    return value;
  }

  skip(size: number): void {
    this.require(size);
    this.offset += size;
  }
}

interface LineTables {
  readonly line: Uint8Array;
  readonly lineStr: Uint8Array;
  readonly str: Uint8Array;
}

const EMPTY = new Uint8Array(0);

function lineTables(elf: Uint8Array): LineTables {
  const sections = sectionsOf(elf);
  const line = sections.get('.debug_line') ?? EMPTY;
  const lineStr = sections.get('.debug_line_str') ?? EMPTY;
  const str = sections.get('.debug_str') ?? EMPTY;
  return { line, lineStr, str };
}

interface FileEntry {
  readonly name: string;
}

interface FormValue {
  readonly path?: string;
}

function readForm(reader: Reader, form: number, tables: LineTables, offsetSize: number): FormValue {
  switch (form) {
    case 0x08: // DW_FORM_string
      return { path: reader.string() };
    case 0x0e: {
      // DW_FORM_strp
      const at = reader.offsetValue(offsetSize);
      return at < tables.str.length ? { path: cString(tables.str, at) } : {};
    }
    case 0x1f: {
      // DW_FORM_line_strp
      const at = reader.offsetValue(offsetSize);
      return at < tables.lineStr.length ? { path: cString(tables.lineStr, at) } : {};
    }
    case 0x0b: // data1
      reader.skip(1);
      return {};
    case 0x05: // data2
      reader.skip(2);
      return {};
    case 0x06: // data4
      reader.skip(4);
      return {};
    case 0x07: // data8
      reader.skip(8);
      return {};
    case 0x0d: // udata
      reader.uleb();
      return {};
    case 0x0f: // data16
      reader.skip(16);
      return {};
    case 0x09: {
      // block
      const size = reader.uleb();
      reader.skip(size);
      return {};
    }
    case 0x0a: {
      // block1
      const size = reader.u8();
      reader.skip(size);
      return {};
    }
    case 0x18: {
      // exprloc
      const size = reader.uleb();
      reader.skip(size);
      return {};
    }
    case 0x1a: // strx
    case 0x25: // strx1
      reader.uleb();
      return {};
    case 0x26: // strx2
      reader.skip(2);
      return {};
    case 0x27: // strx3
      reader.skip(3);
      return {};
    case 0x28: // strx4
      reader.skip(4);
      return {};
    default:
      throw new RangeError(`unsupported DWARF form 0x${form.toString(16)}`);
  }
}

interface Format {
  readonly content: number;
  readonly form: number;
}

function readFormats(reader: Reader): Format[] {
  const count = reader.u8();
  const formats: Format[] = [];
  for (let index = 0; index < count; index += 1) {
    formats.push({ content: reader.uleb(), form: reader.uleb() });
  }
  return formats;
}

function readEntry(
  reader: Reader,
  formats: readonly Format[],
  tables: LineTables,
  offsetSize: number,
): FileEntry {
  let name = '';
  for (const format of formats) {
    const value = readForm(reader, format.form, tables, offsetSize);
    if (format.content === 1 && value.path !== undefined) name = value.path;
  }
  return { name };
}

function readV5Files(
  reader: Reader,
  tables: LineTables,
  offsetSize: number,
): FileEntry[] {
  const directoryFormats = readFormats(reader);
  const directoryCount = reader.uleb();
  for (let index = 0; index < directoryCount; index += 1) {
    readEntry(reader, directoryFormats, tables, offsetSize);
  }
  const fileFormats = readFormats(reader);
  const fileCount = reader.uleb();
  const files: FileEntry[] = [{ name: '' }];
  for (let index = 0; index < fileCount; index += 1) {
    files.push(readEntry(reader, fileFormats, tables, offsetSize));
  }
  return files;
}

function readV4Files(reader: Reader): FileEntry[] {
  while (reader.remaining > 0) {
    const directory = reader.string();
    if (directory === '') break;
  }
  const files: FileEntry[] = [{ name: '' }];
  while (reader.remaining > 0) {
    const name = reader.string();
    if (name === '') break;
    reader.uleb(); // directory index
    reader.uleb(); // mtime
    reader.uleb(); // size
    files.push({ name });
  }
  return files;
}

interface State {
  address: number;
  file: number;
  line: number;
  column: number;
  isStmt: boolean;
  endSequence: boolean;
  /** Operation index within a VLIW instruction; always 0 on AVR. */
  opIndex: number;
}

function initialState(defaultIsStmt: boolean): State {
  return {
    address: 0,
    file: 1,
    line: 1,
    column: 0,
    isStmt: defaultIsStmt,
    endSequence: false,
    opIndex: 0,
  };
}

function emit(state: State, files: readonly FileEntry[]): RawDebugLine {
  return {
    address: state.address,
    file: files[state.file]?.name ?? '',
    line: state.line,
    column: state.column,
    endSequence: state.endSequence,
  };
}

function parseUnit(
  reader: Reader,
  tables: LineTables,
  output: RawDebugLine[],
): void {
  const unitLength = reader.u32();
  const offsetSize = unitLength === 0xffffffff ? 8 : 4;
  const length = unitLength === 0xffffffff ? reader.u64() : unitLength;
  const unitEnd = reader.offset + length;
  if (unitEnd > reader.end) throw new RangeError('DWARF unit is truncated');
  const unit = new Reader(reader.bytes, unitEnd, reader.offset);
  const version = unit.u16();
  if (version < 2 || version > 5) {
    reader.offset = unitEnd;
    return;
  }
  const addressSize = version >= 5 ? unit.u8() : 4;
  if (version >= 5) unit.u8(); // segment selector size
  const headerLength = unit.offsetValue(offsetSize);
  const programStart = unit.offset + headerLength;
  if (programStart > unitEnd) throw new RangeError('DWARF line header is truncated');

  const minimumInstructionLength = unit.u8();
  const maximumOperationsPerInstruction = version >= 4 ? unit.u8() : 1;
  const defaultIsStmt = unit.u8() !== 0;
  const lineBase = unit.i8();
  const lineRange = unit.u8();
  const opcodeBase = unit.u8();
  if (opcodeBase === 0 || lineRange === 0) throw new RangeError('DWARF line header is invalid');
  const standardLengths: number[] = [];
  for (let opcode = 1; opcode < opcodeBase; opcode += 1) standardLengths.push(unit.u8());
  const files = version >= 5 ? readV5Files(unit, tables, offsetSize) : readV4Files(unit);

  const program = new Reader(reader.bytes, unitEnd, programStart);
  let state = initialState(defaultIsStmt);
  const advance = (operations: number): void => {
    const total = state.opIndex + operations;
    state.address += minimumInstructionLength * Math.floor(total / maximumOperationsPerInstruction);
    state.opIndex = total % maximumOperationsPerInstruction;
  };
  const reset = (): void => {
    state = initialState(defaultIsStmt);
    state.opIndex = 0;
  };
  // `opIndex` is part of the machine only for VLIW targets; AVR always uses
  // one operation per instruction, but keeping it costs nothing and makes the
  // arithmetic match the specification.
  state.opIndex = 0;

  while (program.remaining > 0) {
    const opcode = program.u8();
    if (opcode === 0) {
      const length = program.uleb();
      const next = program.offset + length;
      if (next > unitEnd) throw new RangeError('DWARF extended opcode is truncated');
      const sub = program.u8();
      if (sub === 1) {
        state.endSequence = true;
        output.push(emit(state, files));
        reset();
      } else if (sub === 2) {
        let address = 0;
        for (let byte = 0; byte < addressSize; byte += 1) {
          address += program.u8() * 2 ** (8 * byte);
        }
        state.address = address;
        state.opIndex = 0;
      } else if (sub === 3 && version <= 4) {
        const name = program.string();
        program.uleb();
        program.uleb();
        program.uleb();
        if (name !== '') files.push({ name });
      } else if (sub === 4) {
        program.uleb();
      }
      program.offset = next;
      continue;
    }

    if (opcode < opcodeBase) {
      switch (opcode) {
        case 1: // copy
          state.endSequence = false;
          output.push(emit(state, files));
          break;
        case 2: {
          // advance_pc
          advance(program.uleb());
          break;
        }
        case 3:
          state.line += program.sleb();
          break;
        case 4:
          state.file = program.uleb();
          break;
        case 5:
          state.column = program.uleb();
          break;
        case 6:
          state.isStmt = !state.isStmt;
          break;
        case 7:
          break;
        case 8: {
          // const_add_pc
          const operations = Math.floor((255 - opcodeBase) / lineRange);
          advance(operations);
          break;
        }
        case 9:
          state.address += program.uleb();
          state.opIndex = 0;
          break;
        case 10:
        case 11:
          break;
        case 12:
          program.uleb();
          break;
        default:
          for (let operand = 0; operand < (standardLengths[opcode - 1] ?? 0); operand += 1) {
            program.uleb();
          }
          break;
      }
      continue;
    }

    const adjusted = opcode - opcodeBase;
    advance(Math.floor(adjusted / lineRange));
    state.line += lineBase + (adjusted % lineRange);
    state.endSequence = false;
    output.push(emit(state, files));
  }

  reader.offset = unitEnd;
}

/**
 * Parses every `.debug_line` unit in an ELF image. A malformed section is
 * ignored rather than allowed to fail a compile: debug info is an aid, and a
 * successful build must keep running.
 */
export function parseElfDebugLines(elf: Uint8Array): RawDebugLine[] {
  try {
    const tables = lineTables(elf);
    if (tables.line.length === 0) return [];
    const output: RawDebugLine[] = [];
    const reader = new Reader(tables.line, tables.line.length);
    while (reader.remaining >= 4) {
      try {
        parseUnit(reader, tables, output);
      } catch {
        break;
      }
    }
    return output;
  } catch {
    return [];
  }
}
