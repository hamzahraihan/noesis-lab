// Custom-slot library builds: one translation unit per remaining `.cpp`.
//
// - Pruning: `examples/`, `docs/`, and `test/` path prefixes are dropped
//   before anything else. The match is case-sensitive with a trailing slash,
//   so `TEST/foo.cpp` still compiles while `test/foo.cpp` does not.
// - Headers: every remaining `.h` file is keyed by basename (original casing
//   preserved, first wins) and a fresh copy of the full map is passed to
//   every TU, so a quoted `#include "MyLib.h"` inside a custom `.cpp`
//   resolves to its sibling slot header through the `compileUnit` seam, and
//   a mutating callee cannot leak state across translation units.
// - Lint: Plan L1 `lintPrototypes` is deliberately NOT surfaced here. Verified
//   against packager.ts: applied per `.cpp` text alone it flags same-line
//   defined-with-body functions (e.g. `int f(){return 1;}` reports `f` as a
//   use-before-define), and a use-before-define across files is legal C++
//   anyway. Cross-file order issues surface as GCC errors mapped per file by
//   the link step instead.
// - Link order: returned objects follow slot file order. The link step places
//   slot objects before provided objects, so on duplicate symbols the slot
//   wins (GNU ld first-wins shadowing).
import type { LibrarySlot } from './model';

/** Same `compileUnit` seam shape as tier2.ts — duplicated locally, not imported. */
export type CustomCompileUnit = (
  source: string,
  headers: ReadonlyMap<string, string>,
) => Promise<Uint8Array>;

const PRUNED_PREFIXES: readonly string[] = ['examples/', 'docs/', 'test/'];

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

function isPruned(path: string): boolean {
  return PRUNED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * A worker-ready translation unit: basename object name, full source, and a
 * private copy of every live slot header (basename -> content, first wins).
 * `path` is the originating slot path for per-file error mapping.
 */
export interface CustomUnit {
  readonly name: string;
  readonly path: string;
  readonly source: string;
  readonly headers: ReadonlyMap<string, string>;
}

export function collectCustomUnits(slot: LibrarySlot): { units: CustomUnit[]; diagnostics: string[] } {
  const live = slot.files.filter((file) => !isPruned(file.path));
  const headers = new Map<string, string>();
  for (const file of live) {
    if (file.path.endsWith('.h')) {
      const name = baseName(file.path);
      if (!headers.has(name)) headers.set(name, file.content);
    }
  }
  const sources = live.filter((file) => file.path.endsWith('.cpp'));
  if (sources.length === 0) {
    return { units: [], diagnostics: [`<${slot.name}>: no compilable sources`] };
  }
  return {
    units: sources.map((unit) => ({
      name: baseName(unit.path),
      path: unit.path,
      source: unit.content,
      headers: new Map(headers),
    })),
    diagnostics: [],
  };
}

export async function buildCustomObjects(
  slot: LibrarySlot,
  compileUnit: CustomCompileUnit,
): Promise<{ objects: Uint8Array[]; diagnostics: string[] }> {
  const { units, diagnostics } = collectCustomUnits(slot);
  if (units.length === 0) {
    return { objects: [], diagnostics };
  }
  const objects: Uint8Array[] = [];
  for (const unit of units) {
    objects.push(await compileUnit(unit.source, unit.headers));
  }
  return { objects, diagnostics: [] };
}
