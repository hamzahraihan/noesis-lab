import type { FirmwareProject } from '@/features/simulation/firmware/project';

export interface PackedLine {
  readonly file: string;
  readonly line: number;
}

export interface PackedSketch {
  readonly source: string;
  /** Origin of TU line i+1: originating file + 1-based line. */
  readonly lineMap: readonly PackedLine[];
}

const LOCAL_INCLUDE_OF = /^\s*#include\s+"([^"]+)"\s*$/;
const ARDUINO_INCLUDE = /^\s*#\s*include\s*<Arduino\.h>/;

/** Flattens a multi-file project into the single TU the WASM toolchain takes. */
export function packageSketch(project: FirmwareProject): PackedSketch {
  const lines: string[] = [];
  const lineMap: PackedLine[] = [];
  const tabNames = new Set(project.files.map((file) => file.name.toLowerCase()));
  const push = (file: string, content: string): void => {
    const parts = content.split('\n');
    // Drop the trailing artifact of a final newline so concatenated tabs do
    // not gain blank separator lines; kept lines retain 1-based numbers.
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
    parts.forEach((text, index) => {
      const local = text.match(LOCAL_INCLUDE_OF);
      // Quoted non-tab includes ride through: they resolve via the toolchain -I roots; stripping them breaks system headers like "Arduino.h".
      if (local !== null && tabNames.has(local[1]!.toLowerCase())) return;
      lines.push(text);
      lineMap.push({ file, line: index + 1 });
    });
  };
  for (const file of project.files) {
    if (file.name === project.activeName) continue;
    push(file.name, file.content);
  }
  const entry = project.files.find((file) => file.name === project.activeName);
  if (entry) push(entry.name, entry.content);
  if (!lines.some((text) => ARDUINO_INCLUDE.test(text))) {
    lines.unshift('#include <Arduino.h>');
    lineMap.unshift({ file: '<packager>', line: 0 });
  }
  return { source: lines.length > 0 ? `${lines.join('\n')}\n` : '', lineMap };
}

/** Calls `name(` with no prior definition/declaration — the IDE auto-prototype class. Hint only. */
export function lintPrototypes(source: string): Array<{ line: number; name: string }> {
  const defined = new Set<string>();
  const hits: Array<{ line: number; name: string }> = [];
  const definition = /^\s*((?:[\w:<>*&]+\s+)+)(\w+)\s*\([^;]*\)\s*\{?\}?\s*;?\s*$/;
  const keywords = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'else']);
  source.split('\n').forEach((text, index) => {
    const def = text.match(definition);
    if (def) {
      const firstWord = def[1].trim().split(/\s+/)[0];
      if (!keywords.has(def[2]) && !keywords.has(firstWord!)) defined.add(def[2]);
    }
    const calls = new RegExp('\\b([A-Za-z_]\\w*)\\s*\\(', 'g');
    let match: RegExpExecArray | null;
    while ((match = calls.exec(text)) !== null) {
      if (!keywords.has(match[1]) && !defined.has(match[1])) {
        hits.push({ line: index + 1, name: match[1] });
        defined.add(match[1]); // flag first use only
      }
    }
  });
  return hits;
}
