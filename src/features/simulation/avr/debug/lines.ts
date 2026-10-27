/**
 * Source-line mapping for compiled AVR firmware.
 *
 * DWARF speaks in translation-unit lines (`HorangFirmware.cpp:17`) and byte
 * addresses. The bench speaks in sketch tabs and flash words. This module is
 * the translation: it folds the raw line program through the packager's
 * `lineMap`, converts byte addresses to AVR word addresses, and answers the
 * two questions the debugger asks -- "which line is this PC on?" and "where
 * does this line start?".
 */

import type { PackedLine } from '../packager';
import type { DebugLine, DebugUnitMap } from './model';
import type { RawDebugLine } from './dwarf';

export type { CompiledDebugInfo, DebugLine, DebugUnitMap } from './model';
export { parseDebugInfo } from './validate';

function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash < 0 ? path : path.slice(slash + 1);
}

/**
 * Translates raw DWARF rows through each unit's `lineMap`.
 *
 * Rows naming a file no unit knows (system headers, runtime objects) are
 * dropped: a breakpoint there is not a sketch line and cannot be set from the
 * editor. The packager's synthetic `<packager>` line is dropped for the same
 * reason. Rows that differ only in file/line are kept even at the same PC: the
 * compiler records a function's opening brace and its first statement at one
 * address, and a breakpoint on either line must resolve to it.
 */
export function buildDebugLines(
  rows: readonly RawDebugLine[],
  units: readonly DebugUnitMap[],
): DebugLine[] {
  const maps = new Map<string, readonly PackedLine[]>();
  for (const unit of units) {
    const key = baseName(unit.unit).toLowerCase();
    if (!maps.has(key)) maps.set(key, unit.lineMap);
  }
  const seen = new Set<string>();
  const lines: DebugLine[] = [];
  for (const row of rows) {
    if (row.endSequence || row.line <= 0) continue;
    const map = maps.get(baseName(row.file).toLowerCase());
    if (map === undefined) continue;
    const origin = map[row.line - 1];
    if (origin === undefined || origin.file === '' || origin.file === '<packager>') continue;
    if (origin.line <= 0 || row.address < 0) continue;
    const pc = Math.floor(row.address / 2);
    if (!Number.isSafeInteger(pc)) continue;
    const key = `${pc}:${origin.file}:${origin.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ pc, file: origin.file, line: origin.line });
  }
  return lines.sort((a, b) => a.pc - b.pc);
}

/**
 * Index of the last row at or before `pc`, or -1 when the PC precedes all rows.
 * When several rows share the PC, the last one wins as the instruction's
 * canonical line: DWARF emits the later statement (the one the instruction
 * actually performs) last.
 */
function lineIndexAt(lines: readonly DebugLine[], pc: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const row = lines[middle];
    if (row === undefined) break;
    if (row.pc <= pc) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found >= 0) {
    while (found + 1 < lines.length && lines[found + 1]?.pc === lines[found]?.pc) found += 1;
  }
  return found;
}

/** The row covering `pc`, or null when the PC is outside the mapped program. */
export function lineAt(lines: readonly DebugLine[], pc: number): DebugLine | null {
  const index = lineIndexAt(lines, pc);
  return index < 0 ? null : (lines[index] ?? null);
}

/** Where a source line starts, in flash words. */
export function pcsForLine(
  lines: readonly DebugLine[],
  file: string,
  line: number,
): number[] {
  const wanted = file.toLowerCase();
  const pcs: number[] = [];
  for (const row of lines) {
    if (row.line === line && row.file.toLowerCase() === wanted) pcs.push(row.pc);
  }
  return pcs;
}

/**
 * The next row after `pc` whose file and line differ from the current one.
 *
 * This is the target of a step: a line can own several instructions, and
 * stopping on the second one would not move the highlight.
 */
export function nextDebugLine(lines: readonly DebugLine[], pc: number): DebugLine | null {
  const index = lineIndexAt(lines, pc);
  if (index < 0) return null;
  const current = lines[index];
  if (current === undefined) return null;
  for (let at = index + 1; at < lines.length; at += 1) {
    const row = lines[at];
    if (row === undefined) break;
    if (row.file !== current.file || row.line !== current.line) return row;
  }
  return null;
}
