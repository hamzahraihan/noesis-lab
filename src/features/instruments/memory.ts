import type { DebugMemory } from '@/features/simulation';

export interface MemoryRow {
  readonly address: number;
  readonly hex: string;
  readonly ascii: string;
  readonly hasSp: boolean;
}

/** Eight bytes per row, with printable ASCII and an SP marker. */
export function memoryRows(memory: DebugMemory, sp?: number): MemoryRow[] {
  const rows: MemoryRow[] = [];
  for (let offset = 0; offset < memory.bytes.length; offset += 8) {
    const slice = memory.bytes.slice(offset, offset + 8);
    const address = memory.start + offset;
    rows.push({
      address,
      hex: slice.map((byte) => byte.toString(16).padStart(2, '0')).join(' '),
      ascii: slice
        .map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'))
        .join(''),
      hasSp: sp !== undefined && sp >= address && sp < address + 8,
    });
  }
  return rows;
}
