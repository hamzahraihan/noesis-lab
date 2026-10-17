// src/features/bench/utils/circuit-codec.test.ts
import { describe, expect, it } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import { circuitShareQuery, decodeShareToCircuit, encodeCircuitToShare, isCircuitShareable, CIRCUIT_SHARE_URL_LIMIT } from './circuit-codec';
import { validateCircuit, compile, type CircuitDocument } from '@/features/simulation';

describe('circuit codec', () => {
  /*
   * The link, not just the payload: a bare `+` from lz-string's alphabet reads
   * back as a space through `URLSearchParams`, and a *different* circuit then
   * decodes quietly -- see the same test in `share-codec.test.ts`.
   */
  it('escapes the query pair so a circuit survives being read back', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
      wires: [],
    };
    const payload = encodeCircuitToShare(doc);
    expect(payload, 'the alphabet this guards against').toContain('+');

    const read = new URLSearchParams(circuitShareQuery(doc)).get('circuit');
    expect(read).toBe(payload);
    expect(decodeShareToCircuit(read!)).toEqual(doc);
  });
  it('round-trips a small document', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
      wires: [],
    };
    const encoded = encodeCircuitToShare(doc);
    expect(encoded.length).toBeLessThan(CIRCUIT_SHARE_URL_LIMIT);
    expect(decodeShareToCircuit(encoded)).toEqual(doc);
  });

  it('rejects corrupt payloads', () => {
    expect(decodeShareToCircuit('!!!not-a-payload!!!')).toBeNull();
  });

  it('rejects well-formed payloads that fail circuit validation', () => {
    // Missing version.
    const noVersion = compressToEncodedURIComponent(
      JSON.stringify({ parts: [], wires: [] }),
    );
    expect(decodeShareToCircuit(noVersion)).toBeNull();
    // Missing parts array.
    const noParts = compressToEncodedURIComponent(
      JSON.stringify({ version: 1, wires: [] }),
    );
    expect(decodeShareToCircuit(noParts)).toBeNull();
    // Wire missing required fields.
    const badWire = compressToEncodedURIComponent(
      JSON.stringify({
        version: 1,
        parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
        wires: [{ id: 'w', from: 'b:x' }],
      }),
    );
    expect(decodeShareToCircuit(badWire)).toBeNull();
  });

  it('rejects well-formed payloads that fail compilation', () => {
    // Unknown part type passes validation but fails compile.
    const unknownType = compressToEncodedURIComponent(
      JSON.stringify({
        version: 1,
        parts: [{ id: 'x', type: 'no-such-part', x: 0, y: 0, rotation: 0 }],
        wires: [],
      }),
    );
    expect(decodeShareToCircuit(unknownType)).toBeNull();
    // Unsupported version passes validation but fails compile.
    const badVersion = compressToEncodedURIComponent(
      JSON.stringify({
        version: 99,
        parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
        wires: [],
      }),
    );
    expect(decodeShareToCircuit(badVersion)).toBeNull();
  });

  it('keeps small documents shareable', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
      wires: [],
    };
    expect(isCircuitShareable(doc)).toBe(true);
  });

  it('flags an oversized document as unshareable', () => {
    let state = 0x12345678;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) % 62;
    };
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const filler = Array.from({ length: 6000 }, () => alphabet[next()]).join('');
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0, name: filler }],
      wires: [],
    };
    expect(validateCircuit(doc)).toEqual([]);
    expect(compile(doc).errors).toEqual([]);
    expect(encodeCircuitToShare(doc).length).toBeGreaterThan(CIRCUIT_SHARE_URL_LIMIT);
    expect(isCircuitShareable(doc)).toBe(false);
  });

  it('round-trips state and wires', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
      wires: [],
    };
    const encoded = encodeCircuitToShare(doc);
    expect(decodeShareToCircuit(encoded)).toEqual(doc);
  });
});
