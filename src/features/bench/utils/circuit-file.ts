/**
 * Circuit files: what `Save circuit` writes and what `Open circuit…` reads.
 *
 * The document is the file — no wrapper, no manifest — and it is written the
 * way `learn/circuits/*.json` are written, so a circuit downloaded from the
 * bench can be renamed and committed as-is, and a file checked into the repo
 * can be opened on the bench as-is. That equivalence is pinned by a test over
 * every shipped circuit, and it is the whole point: handing a circuit over and
 * publishing one become the same act.
 */

import { documentForFile, parseCircuit, type CircuitDocument } from '@/features/simulation';

/**
 * A wrong file cannot wedge the read. The whole shipped corpus — seventeen
 * circuits — is about 44 kB, so this is far above anything real and only
 * stops a file that was never a circuit.
 */
export const CIRCUIT_FILE_MAX_BYTES = 1_048_576;

/** Shown when a chosen file is not a circuit this bench can open. */
export const UNREADABLE_FILE_NOTICE =
  'That circuit file could not be read, so the bench kept the circuit it had.';

/**
 * What a downloaded circuit is called.
 *
 * Named for the board rather than an exercise: a file off the bench is nobody's
 * lesson yet, and the document already names the board it belongs to. Renaming
 * it to `<id>.json` is how it becomes a shipped circuit.
 */
export function circuitFileName(boardId: string): string {
  return `noesis-${boardId}-circuit.json`;
}

/**
 * A document as file text: two-space JSON and a trailing newline, which is
 * exactly how `decompile`'s output is stored under `learn/circuits/`.
 *
 * Written through `documentForFile`, so the file carries the definitions its
 * parts actually use and nothing else: a circuit of shipped parts is byte-for-
 * byte what it always was, and one that brought a part along says so.
 */
export function circuitFileText(doc: CircuitDocument): string {
  return `${JSON.stringify(documentForFile(doc), null, 2)}\n`;
}

/**
 * A file's text as a document, or a thrown error naming the file.
 *
 * Malformed JSON is caught here rather than left as a `SyntaxError` about a
 * character position: the operator chose a file, and the useful thing to say is
 * which file and that it is not a circuit. Everything past that — the shape,
 * the version, whether the part types exist, whether the wires land on pins —
 * is `parseCircuit`'s gate, the same one a link and an autosave pass through.
 */
export function readCircuitFile(text: string, label: string): CircuitDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label}: not JSON`);
  }
  return parseCircuit(parsed, label);
}
