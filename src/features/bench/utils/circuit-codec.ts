import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { validateCircuit, compile, type CircuitDocument } from '@/features/simulation';

export const CIRCUIT_SHARE_URL_LIMIT = 3000;

export function encodeCircuitToShare(doc: CircuitDocument): string {
  return compressToEncodedURIComponent(JSON.stringify(doc));
}

/**
 * The `?circuit=` pair for a circuit, ready to hang off a url.
 *
 * Escaped for the same reason the project's is: lz-string's alphabet contains
 * `+`, and `URLSearchParams` reads a bare `+` as a space, after which a
 * different circuit decodes without complaint. `%2B` survives.
 */
export function circuitShareQuery(doc: CircuitDocument): string {
  return `circuit=${encodeURIComponent(encodeCircuitToShare(doc))}`;
}

export function decodeShareToCircuit(payload: string): CircuitDocument | null {
  try {
    const raw = decompressFromEncodedURIComponent(payload);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (validateCircuit(parsed).length > 0) return null;
    const result = compile(parsed);
    if (result.errors.length > 0) return null;
    return parsed as CircuitDocument;
  } catch {
    return null;
  }
}

export function isCircuitShareable(doc: CircuitDocument): boolean {
  return encodeCircuitToShare(doc).length <= CIRCUIT_SHARE_URL_LIMIT;
}
