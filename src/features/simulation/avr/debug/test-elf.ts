/** Shared synthetic ELF builder for the DWARF parser tests. */

export function uleb(value: number): number[] {
  const out: number[] = [];
  let n = value >>> 0;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

export function sleb(value: number): number[] {
  const out: number[] = [];
  let n = value | 0;
  for (;;) {
    const byte = n & 0x7f;
    n >>= 7;
    const done = (n === 0 && (byte & 0x40) === 0) || (n === -1 && (byte & 0x40) !== 0);
    out.push(done ? byte : byte | 0x80);
    if (done) return out;
  }
}

export function cstr(text: string): number[] {
  return [...new TextEncoder().encode(text), 0];
}

export function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

export function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

const STANDARD_LENGTHS = [0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1];

export function v4LineTable(): Uint8Array {
  const header = [
    ...u16(4),
    ...u32(0), // header_length patched below
    2, // minimum_instruction_length
    1, // maximum_operations_per_instruction
    1, // default_is_stmt
    0xfb, // line_base -5
    14, // line_range
    13, // opcode_base
    ...STANDARD_LENGTHS,
    ...cstr('/build'),
    ...cstr(''),
    ...cstr('HorangFirmware.cpp'),
    ...uleb(0),
    ...uleb(0),
    ...uleb(0),
    0, // end file table
  ];
  const program = [
    0,
    ...uleb(5),
    2,
    ...u32(0x0100),
    3,
    ...sleb(2),
    1, // copy -> address 0x100, line 3
    2,
    ...uleb(4), // advance_pc: +4 operations * 2 bytes
    3,
    ...sleb(1),
    1, // copy -> address 0x108, line 4
    2,
    ...uleb(8), // advance_pc: +16 bytes
    0,
    ...uleb(1),
    1, // end_sequence
  ];
  const headerLength = header.length - 6;
  header.splice(2, 4, ...u32(headerLength));
  const unitBody = [...header, ...program];
  return new Uint8Array([...u32(unitBody.length), ...unitBody]);
}

/** A DWARF 2 line unit with a file table and no executable rows. */
export function dwarfLineTable(fileName = 'HorangFirmware.cpp'): Uint8Array {
  const header = [
    ...u16(2), // version
    ...u32(0), // header_length patched below
    2, // minimum_instruction_length
    1, // default_is_stmt
    0xfb, // line_base -5
    14, // line_range
    13, // opcode_base
    ...STANDARD_LENGTHS,
    ...cstr('/build'),
    ...cstr(''),
    ...cstr(fileName),
    ...uleb(0),
    ...uleb(0),
    ...uleb(0),
    0, // end file table
  ];
  header.splice(2, 4, ...u32(header.length - 6));
  return new Uint8Array([...u32(header.length + 1), ...header, 0]);
}

/** Minimal ELF32 little-endian executable carrying named sections. */
export function elfWithSections(
  sections: ReadonlyArray<{ name: string; data: Uint8Array }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const names: number[] = [0];
  const nameOffsets: number[] = [];
  for (const section of sections) {
    nameOffsets.push(names.length);
    names.push(...encoder.encode(section.name), 0);
  }
  const shstrName = names.length;
  names.push(...encoder.encode('.shstrtab'), 0);
  const shstrtab = new Uint8Array(names);
  let offset = 52;
  for (const section of sections) offset += section.data.length;
  const shstrOffset = offset;
  offset += shstrtab.length;
  const sectionHeaderOffset = (offset + 3) & ~3;
  const sectionCount = sections.length + 2;
  const out = new Uint8Array(sectionHeaderOffset + sectionCount * 40);
  const view = new DataView(out.buffer);
  out.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0], 0);
  view.setUint16(16, 2, true); // ET_EXEC
  view.setUint16(18, 83, true); // EM_AVR
  view.setUint32(20, 1, true);
  view.setUint32(32, sectionHeaderOffset, true);
  view.setUint16(40, 52, true);
  view.setUint16(46, 40, true);
  view.setUint16(48, sectionCount, true);
  view.setUint16(50, sectionCount - 1, true);

  let dataOffset = 52;
  const writeSection = (index: number, name: number, type: number, at: number, size: number) => {
    const base = sectionHeaderOffset + index * 40;
    view.setUint32(base, name, true);
    view.setUint32(base + 4, type, true);
    view.setUint32(base + 16, at, true);
    view.setUint32(base + 20, size, true);
    view.setUint32(base + 24, 1, true);
  };
  sections.forEach((section, index) => {
    out.set(section.data, dataOffset);
    writeSection(index + 1, nameOffsets[index]!, 1, dataOffset, section.data.length);
    dataOffset += section.data.length;
  });
  out.set(shstrtab, shstrOffset);
  writeSection(sectionCount - 1, shstrName, 3, shstrOffset, shstrtab.length);
  return out;
}
