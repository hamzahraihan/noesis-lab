import { describe, expect, it } from 'vitest';
import { partDefinitionById } from '@/features/parts';
import { BUTTON_CAP_COLOURS } from './bench';
import {
  addPart,
  addWire,
  movePart,
  moveWireEnd,
  removePart,
  removeWire,
  rotatePart,
  setCapColour,
  setKnob,
  setPartName,
  setWireBends,
  setWireColour,
  type EditResult,
  type PartRotation,
} from './circuit-edit';
import { compile, decompile, type CircuitDocument } from './circuit-doc';

const BASE: CircuitDocument = {
  version: 1,
  parts: [
    { id: 'p1', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 },
    { id: 'p2', type: 'led-red', x: 80, y: 20, rotation: 0 },
  ],
  wires: [{ id: 'w1', from: 'p1:D13', to: 'p2:A', colour: '#d94f4f', gaugeAwg: 26, bends: [] }],
};

/** The order and shape `decompile` writes, so a round trip compares cleanly. */
function canonical(doc: CircuitDocument): CircuitDocument {
  const byId = (a: { id: string }, b: { id: string }): number =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return {
    ...doc,
    parts: [...doc.parts].sort(byId),
    wires: [...doc.wires].sort(byId),
  };
}

/** What every edit has to survive: compile, decompile, and compare as written. */
function roundTrips(doc: CircuitDocument): void {
  const { bench, dynamicState, errors } = compile(doc);
  expect(errors).toEqual([]);
  expect(bench).not.toBeNull();
  const { doc: derived, warnings } = decompile(bench!, dynamicState!);
  expect(warnings).toEqual([]);
  expect(canonical(derived)).toEqual(canonical(doc));
}

const WIRE = { colour: '#22c55e', gaugeAwg: 26 };

describe('placing and moving parts', () => {
  it('appends a part with the next id and reports it', () => {
    const result = addPart(BASE, 'resistor-220', 10, 12);
    expect(result.error).toBeUndefined();
    expect(result.partId).toBe('p3');
    expect(result.doc.parts.map((part) => part.id)).toEqual(['p1', 'p2', 'p3']);
    expect(result.doc.parts[2]).toEqual({
      id: 'p3',
      type: 'resistor-220',
      x: 10,
      y: 12,
      rotation: 0,
    });
    // The input is untouched: a document is a value, not storage.
    expect(BASE.parts).toHaveLength(2);
  });

  it('refuses a part type the catalogue does not know', () => {
    const result = addPart(BASE, 'flux-capacitor', 0, 0);
    expect(result.error).toMatch(/unknown part type/);
    expect(result.doc).toBe(BASE);
  });

  it('moves and turns one part without touching the others', () => {
    const moved = movePart(BASE, 'p2', 120, 40);
    expect(moved.doc.parts[1]).toEqual({ ...BASE.parts[1], x: 120, y: 40 });
    expect(moved.doc.parts[0]).toBe(BASE.parts[0]);

    const turned = rotatePart(BASE, 'p2', 90);
    expect(turned.doc.parts[1]?.rotation).toBe(90);

    expect(rotatePart(BASE, 'p2', 45 as PartRotation).error).toMatch(/invalid rotation/);
    expect(movePart(BASE, 'p9', 0, 0).error).toMatch(/unknown part/);
  });

  it('takes a part off the bench and drops only the wires that reached it', () => {
    const three: CircuitDocument = {
      ...BASE,
      parts: [...BASE.parts, { id: 'p3', type: 'led-red', x: 140, y: 20, rotation: 0 }],
      wires: [
        ...BASE.wires,
        { id: 'w2', from: 'p2:K', to: 'p3:A', colour: '#ef4444', gaugeAwg: 26, bends: [] },
      ],
    };
    const withoutMiddle = removePart(three, 'p2');
    expect(withoutMiddle.doc.parts.map((part) => part.id)).toEqual(['p1', 'p3']);
    expect(withoutMiddle.doc.wires).toEqual([]);

    const withoutLast = removePart(three, 'p3');
    expect(withoutLast.doc.wires.map((wire) => wire.id)).toEqual(['w1']);
    expect(removePart(three, 'p9').error).toMatch(/unknown part/);
  });
});

describe('routing', () => {
  it('routes a jumper with the next id, in the short pin form', () => {
    const result = addWire(BASE, 'p1:D12', 'p2:anode', WIRE);
    expect(result.error).toBeUndefined();
    expect(result.wireId).toBe('w2');
    expect(result.doc.wires[1]).toEqual({
      id: 'w2',
      from: 'p1:D12',
      to: 'p2:A',
      colour: '#22c55e',
      gaugeAwg: 26,
      bends: [],
    });
    expect(BASE.wires).toHaveLength(1);
  });

  it('refuses unknown pins, unknown parts, malformed refs and a pin to itself', () => {
    expect(addWire(BASE, 'p1:NOPE', 'p2:A', WIRE).error).toMatch(/unknown pin/);
    expect(addWire(BASE, 'p9:D13', 'p2:A', WIRE).error).toMatch(/unknown part/);
    expect(addWire(BASE, 'p1-D13', 'p2:A', WIRE).error).toMatch(/invalid pin reference/);
    expect(addWire(BASE, 'p1:D13', 'p1:D13', WIRE).error).toMatch(/two different pins/);
  });

  it('re-clips one end and refuses to make a wire end on itself', () => {
    const moved = moveWireEnd(BASE, 'w1', 'to', 'p2:cathode');
    expect(moved.error).toBeUndefined();
    expect(moved.doc.wires[0]?.to).toBe('p2:K');
    expect(moveWireEnd(BASE, 'w1', 'to', 'p1:D13').error).toMatch(/two different pins/);
    expect(moveWireEnd(BASE, 'w9', 'to', 'p2:A').error).toMatch(/unknown wire/);
  });

  it('stores bends as plain points', () => {
    const bends = [
      { x: 10, y: 5 },
      { x: 10, y: 20 },
    ];
    const result = setWireBends(BASE, 'w1', bends);
    expect(result.doc.wires[0]?.bends).toEqual(bends);
    expect(result.doc.wires[0]?.bends).not.toBe(bends);
    expect(setWireBends(BASE, 'w9', bends).error).toMatch(/unknown wire/);
  });

  it('removes a wire by id', () => {
    expect(removeWire(BASE, 'w1').doc.wires).toEqual([]);
    expect(removeWire(BASE, 'w9').error).toMatch(/unknown wire/);
  });

  it('recolours a wire without touching its route', () => {
    const result = setWireColour(BASE, 'w1', '#22c55e');
    expect(result.doc.wires[0]).toEqual({ ...BASE.wires[0], colour: '#22c55e' });
    expect(setWireColour(BASE, 'w9', '#22c55e').error).toMatch(/unknown wire/);
  });
});

describe('what a part reads as', () => {
  it('sets and clears a name', () => {
    const named = setPartName(BASE, 'p2', 'Status LED');
    expect(named.doc.parts[1]?.name).toBe('Status LED');
    const cleared = setPartName(named.doc, 'p2', null);
    expect(cleared.doc.parts[1]).not.toHaveProperty('name');
  });

  it('accepts only a palette cap colour, and clears with null', () => {
    const palette = BUTTON_CAP_COLOURS[0]!;
    expect(setCapColour(BASE, 'p1', palette).doc.parts[0]?.capColour).toBe(palette);
    expect(setCapColour(BASE, 'p1', '#123456').error).toMatch(/invalid cap colour/);
    expect(setCapColour(BASE, 'p1', null).doc.parts[0]).not.toHaveProperty('capColour');
  });
});

describe('knobs', () => {
  const pot = partDefinitionById('slide-potentiometer')!;
  const knob = pot.knobs![0]!;
  const withPot: CircuitDocument = {
    ...BASE,
    parts: [...BASE.parts, { id: 'p3', type: 'slide-potentiometer', x: 40, y: 40, rotation: 0 }],
  };

  it('stores the value it was given, clamped to the range the part declares', () => {
    expect(setKnob(withPot, `p3:${knob.id}`, knob.min - 100).doc.state?.knobs).toEqual({
      [`p3:${knob.id}`]: knob.min,
    });
    expect(setKnob(withPot, `p3:${knob.id}`, knob.max + 100).doc.state?.knobs).toEqual({
      [`p3:${knob.id}`]: knob.max,
    });
  });

  it('refuses an unknown part, knob or key', () => {
    expect(setKnob(withPot, 'p9:wiper', 0).error).toMatch(/unknown part/);
    expect(setKnob(withPot, 'p3:nonsense', 0).error).toMatch(/unknown knob/);
    expect(setKnob(withPot, 'nocolon', 0).error).toMatch(/invalid knob key/);
  });

  it('does not touch the parts or the wires', () => {
    const result = setKnob(withPot, `p3:${knob.id}`, knob.min);
    expect(result.doc.parts).toBe(withPot.parts);
    expect(result.doc.wires).toBe(withPot.wires);
  });
});

describe('every edit survives a round trip through the bench', () => {
  const pot = partDefinitionById('slide-potentiometer')!;
  const knob = pot.knobs![0]!;
  const withPot: CircuitDocument = {
    ...BASE,
    parts: [...BASE.parts, { id: 'p3', type: 'slide-potentiometer', x: 40, y: 40, rotation: 0 }],
  };
  const withName: CircuitDocument = {
    ...BASE,
    parts: [{ ...BASE.parts[0]!, name: 'Board' }, BASE.parts[1]!],
  };
  const withCap: CircuitDocument = {
    ...BASE,
    parts: [{ ...BASE.parts[0]!, capColour: BUTTON_CAP_COLOURS[0]! }, BASE.parts[1]!],
  };
  const threeLeds: CircuitDocument = {
    ...BASE,
    parts: [...BASE.parts, { id: 'p3', type: 'resistor-220', x: 140, y: 20, rotation: 0 }],
  };

  const edits: ReadonlyArray<[string, EditResult]> = [
    ['adds a part', addPart(BASE, 'resistor-220', 10, 12)],
    ['moves a part', movePart(BASE, 'p2', 120, 40)],
    ['turns a part', rotatePart(BASE, 'p2', 90)],
    ['removes a part', removePart(threeLeds, 'p3')],
    ['names a part', setPartName(BASE, 'p2', 'Status LED')],
    ['clears a name', setPartName(withName, 'p1', null)],
    ['sets a cap colour', setCapColour(BASE, 'p1', BUTTON_CAP_COLOURS[0]!)],
    ['clears a cap colour', setCapColour(withCap, 'p1', null)],
    ['adds a wire', addWire(BASE, 'p1:D12', 'p2:cathode', { colour: '#22c55e', gaugeAwg: 22 })],
    ['removes a wire', removeWire(BASE, 'w1')],
    ['re-clips a wire', moveWireEnd(BASE, 'w1', 'from', 'p1:D12')],
    ['bends a wire', setWireBends(BASE, 'w1', [{ x: 30, y: 6 }])],
    ['turns a knob', setKnob(withPot, `p3:${knob.id}`, knob.min)],
  ];

  for (const [name, result] of edits) {
    it(name, () => {
      expect(result.error).toBeUndefined();
      roundTrips(result.doc);
    });
  }
});
