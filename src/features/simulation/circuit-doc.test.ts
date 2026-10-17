import { describe, expect, it } from 'vitest';
import { BenchBuilder } from '@/features/simulation';
import { arduinoUnoR3, DynamicState, rotateOffset } from '@/features/parts';
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
    expect(result.errors).toEqual([]);
    expect(result.bench).not.toBeNull();
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

describe('decompile', () => {
  it('round-trips a hand-authored document', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [
        { id: 'led', type: 'led-red', x: 50, y: 0, rotation: 0 },
        { id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0, name: 'Main' },
      ],
      wires: [{ id: 'w', from: 'u:D13', to: 'led:A', colour: '#f00', gaugeAwg: 26, bends: [{ x: 10, y: 5 }] }],
      state: { knobs: {} },
    };
    const compiled = compile(doc);
    expect(compiled.errors).toEqual([]);
    const { doc: out, warnings } = decompile(compiled.bench!, compiled.dynamicState!);
    expect(warnings).toEqual([]);
    expect(out.version).toBe(1);
    expect(out.parts).toEqual(doc.parts);
    expect(out.wires).toEqual(doc.wires);
  });

  /*
   * Every bench carries the breadboard, and its own definition id differs from
   * the catalogue's display name — the same is true of the character LCD and
   * the I2C OLED. A document is decompiled from a real bench and loaded back
   * through `compile`, so all three ids have to resolve, or a saved bench
   * reopens as "could not be read" with its breadboard dropped.
   */
  it('round-trips a document that carries the breadboard and a character LCD', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [
        { id: 'bb', type: 'breadboard-830', x: 230, y: 0, rotation: 0 },
        { id: 'lcd', type: 'lcd-16x2', x: 100, y: 70, rotation: 0 },
        { id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 },
      ],
      wires: [{ id: 'w', from: 'u:D12', to: 'lcd:RS', colour: '#a3e635', gaugeAwg: 26, bends: [] }],
    };
    const compiled = compile(doc);
    expect(compiled.errors).toEqual([]);
    const { doc: out, warnings } = decompile(compiled.bench!, compiled.dynamicState!);
    expect(warnings).toEqual([]);
    expect(out).toEqual(doc);
    expect(compile(out).errors).toEqual([]);
  });

  it('drops a loose-end wire with a warning', () => {
    const b = new BenchBuilder();
    const p = b.addPart(arduinoUnoR3(), 0, 0);
    const pinSpec = p.definition.pins[0];
    const off = rotateOffset(pinSpec.x, pinSpec.y, 0, p.definition.widthMm, p.definition.heightMm);
    const x = p.x + off.x;
    const y = p.y + off.y;
    b.addWire(x, y, x + 100, y + 100); // far end claims a loose contact
    const { doc, warnings } = decompile(b.build(), new DynamicState());
    expect(warnings.some((w) => w.includes('loose'))).toBe(true);
    expect(doc.wires).toHaveLength(0);
  });

  it('is pure: the input bench is unchanged', () => {
    const doc: CircuitDocument = { version: 1, parts: [{ id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }], wires: [] };
    const compiled = compile(doc);
    const before = JSON.stringify(compiled.bench);
    decompile(compiled.bench!, compiled.dynamicState!);
    expect(JSON.stringify(compiled.bench)).toBe(before);
  });

  it('filters knob entries for parts not on the bench (Review Focus #4)', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [{ id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
      wires: [],
      state: { knobs: { 'ghost:turn': 0.5 } },
    };
    const compiled = compile(doc);
    // Unknown knob keys are ignored (forward-compat); decompile of the (empty-knob) result must not carry it.
    const { doc: out } = decompile(compiled.bench!, compiled.dynamicState!);
    expect(out.state).toBeUndefined();
  });

  it('sorts parts and wires by id', () => {
    const doc: CircuitDocument = {
      version: 1,
      parts: [
        { id: 'z', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 },
        { id: 'a', type: 'arduino-uno-r3', x: 10, y: 0, rotation: 0 },
      ],
      wires: [],
    };
    const compiled = compile(doc);
    const { doc: out } = decompile(compiled.bench!, compiled.dynamicState!);
    expect(out.parts.map((p) => p.id)).toEqual(['a', 'z']);
  });
});
