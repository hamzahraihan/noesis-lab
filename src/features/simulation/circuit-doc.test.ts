import { describe, expect, it } from 'vitest';
import {
  compile,
  decompile,
  validateCircuit,
  type CircuitDocument,
} from './circuit-doc';

const minimalDoc: CircuitDocument = {
  version: 1,
  parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
  wires: [],
};

describe('validateCircuit', () => {
  it('accepts a minimal valid document', () => {
    expect(validateCircuit(minimalDoc)).toEqual([]);
  });
  it('rejects a missing version', () => {
    const { version, ...rest } = minimalDoc;
    expect(validateCircuit(rest).length).toBeGreaterThan(0);
  });
  it('rejects a non-integer version', () => {
    expect(validateCircuit({ ...minimalDoc, version: 1.5 }).length).toBeGreaterThan(0);
  });
  it('rejects missing parts/wires arrays', () => {
    expect(validateCircuit({ version: 1, wires: [] }).length).toBeGreaterThan(0);
    expect(validateCircuit({ version: 1, parts: [] }).length).toBeGreaterThan(0);
  });
  it('rejects a part without id/type/x/y', () => {
    expect(validateCircuit({ version: 1, parts: [{ type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }], wires: [] }).length).toBeGreaterThan(0);
  });
  it('rejects a wire without from/to/colour/gaugeAwg/bends', () => {
    expect(validateCircuit({ version: 1, parts: minimalDoc.parts, wires: [{ id: 'w', from: 'a:x' }] }).length).toBeGreaterThan(0);
  });
  it('rejects a non-number knob value', () => {
    expect(validateCircuit({ ...minimalDoc, state: { knobs: { 'b:x': 'hi' } } }).length).toBeGreaterThan(0);
  });
});

describe('compile', () => {
  it('compiles a minimal document to a bench with one part', () => {
    const result = compile(minimalDoc);
    expect(result.errors).toEqual([]);
    expect(result.bench).not.toBeNull();
    expect(result.bench!.parts).toHaveLength(1);
    expect(result.bench!.parts[0].id).toBe('b');
    expect(result.bench!.parts[0].definition.id).toBe('arduino-uno-r3');
  });

  it('returns an error and no bench for an unknown version', () => {
    const result = compile({ ...minimalDoc, version: 99 });
    expect(result.bench).toBeNull();
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('returns an error and skips an unknown part type', () => {
    const doc: CircuitDocument = { version: 1, parts: [{ id: 'x', type: 'no-such-part', x: 0, y: 0, rotation: 0 }], wires: [] };
    const result = compile(doc);
    expect(result.errors.some((e) => e.includes('no-such-part'))).toBe(true);
    expect(result.bench!.parts).toHaveLength(0);
  });

  it('reports duplicate part ids', () => {
    const doc: CircuitDocument = { version: 1, parts: [
      { id: 'p', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 },
      { id: 'p', type: 'arduino-uno-r3', x: 10, y: 10, rotation: 0 },
    ], wires: [] };
    const result = compile(doc);
    expect(result.errors.some((e) => e.includes('duplicate part id'))).toBe(true);
  });

  it('reports an invalid pin reference in a wire', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
      wires: [{ id: 'w', from: 'u:NOPE', to: 'u:GND', colour: '#f00', gaugeAwg: 26, bends: [] }],
    };
    const result = compile(doc);
    expect(result.errors.some((e) => e.includes('unknown pin'))).toBe(true);
  });

  it('applies operator state (name, capColour, initialRtc)', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0, name: 'Main', capColour: '#22c55e', initialRtc: { hours: 1, minutes: 2, seconds: 3 } }],
      wires: [],
    };
    const result = compile(doc);
    const part = result.bench!.parts[0];
    expect(part.name).toBe('Main');
    expect(part.capColour).toBe('#22c55e');
    expect(part.initialRtc).toEqual({ hours: 1, minutes: 2, seconds: 3 });
  });

  it('rejects an invalid capColour rather than storing it', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0, capColour: '#abcdef' }],
      wires: [],
    };
    const result = compile(doc);
    expect(result.errors.some((e) => e.includes('capColour'))).toBe(true);
    expect(result.bench!.parts[0].capColour).toBeUndefined();
  });

  it('feeds knob values into the DynamicState, clamped to the spec range', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'pot', type: 'potentiometer-10000', x: 0, y: 0, rotation: 0 }],
      wires: [],
      state: { knobs: { 'pot:turn': 999 } },
    };
    const result = compile(doc);
    expect(result.errors).toEqual([]);
    const spec = result.bench!.parts[0].definition.knobs![0];
    expect(result.dynamicState!.entries().get('pot:turn')).toBe(spec.max);
  });

  it('ignores knob keys referencing unknown parts', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
      wires: [],
      state: { knobs: { 'ghost:turn': 0.5 } },
    };
    const result = compile(doc);
    expect(result.errors.some((e) => e.includes('unknown part'))).toBe(true);
  });

  it('compiles a wire between two pins', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [
        { id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 },
        { id: 'led', type: 'led-red', x: 50, y: 0, rotation: 0 },
      ],
      wires: [{ id: 'w', from: 'u:D13', to: 'led:A', colour: '#f00', gaugeAwg: 26, bends: [] }],
    };
    const result = compile(doc);
    expect(result.errors).toEqual([]);
    expect(result.bench!.wires).toHaveLength(1);
    expect(result.bench!.wires[0].id).toBe('w');
  });

  it('partDefinitionById returns a definition whose id matches the entry id (Review Focus #1)', () => {
    const result = compile({ version: 1, parts: [{ id: 'r', type: 'resistor-220', x: 0, y: 0, rotation: 0 }], wires: [] });
    expect(result.bench!.parts[0].definition.id).toBe('resistor-220');
  });
});

describe('decompile', () => {
  it('round-trips a minimal document', () => {
    const result = compile(minimalDoc);
    const { doc } = decompile(result.bench!, result.dynamicState!);
    expect(doc.parts).toHaveLength(1);
    expect(doc.parts[0].id).toBe('b');
  });
});
