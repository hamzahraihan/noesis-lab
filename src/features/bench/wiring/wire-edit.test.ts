import { describe, expect, it } from 'vitest';
import { BenchBuilder } from '@/features/simulation';
import { Simulation } from '../simulations/simulation';
import { esp32DevKitV1 } from '@/features/parts';
import { breadboardDefinition } from '@/features/parts';
import {
  DEFAULT_WIRE_COLOUR,
  WIRE_COLOURS,
  nextAutomaticWireColour,
} from './wire-colours';

/**
 * Editing a placed jumper.
 *
 * Two operations the bench model gained for Wokwi parity: re-clipping an end onto
 * another contact, and recolouring the insulation. They are different in kind and
 * that difference is the point -- the first is electrical and re-solves the
 * circuit, the second is drawing-only and must not.
 */

function bench() {
  const builder = new BenchBuilder();
  const board = builder.addPart(esp32DevKitV1(), 0, 0);
  builder.addPart(breadboardDefinition(), 230, 0);
  return { builder, board };
}

const pinAt = (builder: BenchBuilder, boardId: string, pinId: string) => {
  const board = builder.build().parts.find((part) => part.id === boardId);
  const spec = board?.definition.pins.find((candidate) => candidate.id === pinId);
  if (!board || !spec) throw new Error(`no pin ${pinId}`);
  return { x: board.x + spec.x, y: board.y + spec.y };
};

describe('dragging a wire end to another hole', () => {
  it('re-clips that end and leaves the other where it was', () => {
    const { builder, board } = bench();
    const start = pinAt(builder, board.id, 'R_D2');
    const end = { x: 300, y: 80 };
    const wire = builder.addWire(start.x, start.y, end.x, end.y);

    const target = { x: 320, y: 120 };
    builder.moveWireEnd(wire.id, 'to', target.x, target.y);
    const moved = builder.build().wires[0];

    const terminals = builder.build().terminals;
    // The far end went to the new place...
    expect(Math.hypot(terminals[moved.to].x - target.x, terminals[moved.to].y - target.y))
      .toBeLessThan(0.001);
    // ...and the near end is exactly where it was, which is what makes this a
    // drag of one end rather than a new wire.
    expect(moved.from).toBe(wire.from);
  });

  it('re-measures, because the route it runs changed', () => {
    const { builder, board } = bench();
    const start = pinAt(builder, board.id, 'R_D2');
    const wire = builder.addWire(start.x, start.y, 300, 80);
    const before = wire.lengthMm;

    builder.moveWireEnd(wire.id, 'to', 320, 150);
    const after = builder.build().wires[0];

    // The solver turns length into resistance, so a re-clipped wire priced at its
    // old length would quietly carry the wrong resistance.
    expect(after.lengthMm).not.toBe(before);
    const terminals = builder.build().terminals;
    const direct = Math.abs(terminals[after.to].x - terminals[after.from].x)
      + Math.abs(terminals[after.to].y - terminals[after.from].y);
    expect(after.lengthMm).toBeCloseTo(direct, 6);
  });

  it('refuses to clip an end onto its own other end', () => {
    const { builder, board } = bench();
    const start = pinAt(builder, board.id, 'R_D2');
    const wire = builder.addWire(start.x, start.y, 300, 80);
    const far = builder.build().terminals[wire.to];
    const terminalsBefore = builder.build().terminals.length;

    builder.moveWireEnd(wire.id, 'to', far.x, far.y);

    // Both ends on one contact would be a wire shorted to itself, which the
    // netlist would silently collapse.
    const after = builder.build().wires[0];
    expect(after.from).not.toBe(after.to);
    expect(builder.build().terminals.length).toBe(terminalsBefore);
  });

  it('shares a contact when dropped on an occupied hole', () => {
    const { builder, board } = bench();
    const first = builder.addWire(
      pinAt(builder, board.id, 'R_D2').x,
      pinAt(builder, board.id, 'R_D2').y,
      300, 80,
    );
    const second = builder.addWire(360, 200, 380, 240);
    const shared = { x: 340, y: 140 };

    // A breadboard hole holds whatever is clipped into it: two jumpers in the
    // same hole are the same contact, which is the whole point of a bus. Both
    // far ends are dropped into the same hole.
    builder.moveWireEnd(first.id, 'to', shared.x, shared.y);
    builder.moveWireEnd(second.id, 'to', shared.x, shared.y);

    const wires = builder.build().wires;
    expect(wires[0].to).toBe(wires[1].to);
  });

  it('releases the contact the end came from', () => {
    const { builder, board } = bench();
    const start = pinAt(builder, board.id, 'R_D2');
    builder.addWire(start.x, start.y, 300, 80);

    // Terminal ids are renumbered whenever the pool is compacted, so the check
    // is by position: a contact nothing holds at (300, 80) must not survive as a
    // phantom net after the end left it.
    const stranded = () => builder.build().terminals.filter(
      (terminal) => Math.hypot(terminal.x - 300, terminal.y - 80) < 0.001,
    );
    expect(stranded()).toHaveLength(1);

    builder.moveWireEnd(builder.build().wires[0].id, 'to', 320, 150);

    expect(stranded()).toHaveLength(0);
  });

  it('carries its bends along when an end moves', () => {
    // Bends are absolute bench positions from the old shape: leaving them
    // behind while the end travels re-threads the wire through stale points
    // and strands nodes in empty space. The shape follows the drag instead,
    // rubber-band style, with the far end pinned.
    const builder = new BenchBuilder();
    const wire = builder.addWire(0, 0, 60, 0, {
      bends: [
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
    });

    builder.moveWireEnd(wire.id, 'to', 80, 0);
    const moved = builder.build().wires[0];

    expect(moved.bends).toEqual([
      { x: 40, y: 0 },
      { x: 40, y: 20 },
    ]);
  });

  it('leaves bends alone when the end stays where it was', () => {
    const builder = new BenchBuilder();
    const wire = builder.addWire(0, 0, 60, 0, {
      bends: [{ x: 20, y: 0 }],
    });

    builder.moveWireEnd(wire.id, 'to', 60, 0);
    const kept = builder.build().wires[0];

    expect(kept.bends).toEqual([{ x: 20, y: 0 }]);
  });

  it('re-solves the circuit, because what the wire joins changed', () => {
    const simulation = new Simulation(esp32DevKitV1());
    simulation.addPart(esp32DevKitV1(), 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    const from = pinAt(simulation.builder, 'p1', 'R_D2');
    simulation.routeWire({ id: -1, ...from }, { id: -1, x: 300, y: 80 });
    const wireId = simulation.bench.wires[0].id;
    const netlist = () => simulation.engine.currentNetlist;

    const before = netlist();
    const boardPinNetBefore = before.pinNode.get('p1:R_D2');

    // Dropped onto a breadboard hole the wire was not touching, so the board pin
    // it comes from is now on a net with a different partner.
    const hole = { x: 230 + 5.08, y: 12.7 };
    simulation.moveWireEnd(wireId, 'to', { id: -1, ...hole });
    const after = netlist();

    // The re-solve is the whole point: the net under the board pin is rebuilt,
    // not left as it was.
    expect(after.pinNode.get('p1:R_D2')).toBeDefined();
    expect(after).not.toBe(before);
    expect(boardPinNetBefore).toBeDefined();
  });
});

describe('changing a wire colour', () => {
  it('changes the wire and touches nothing else', () => {
    const { builder, board } = bench();
    const start = pinAt(builder, board.id, 'R_D2');
    const wire = builder.addWire(start.x, start.y, 300, 80);
    const lengthBefore = wire.lengthMm;
    const endsBefore = { from: wire.from, to: wire.to, bends: wire.bends };

    builder.setWireColour(wire.id, WIRE_COLOURS[4].hex);
    const after = builder.build().wires[0];

    expect(after.colour).toBe(WIRE_COLOURS[4].hex);
    // Insulation carries no electrical meaning, so nothing else may move.
    expect(after.from).toBe(endsBefore.from);
    expect(after.to).toBe(endsBefore.to);
    expect(after.bends).toEqual(endsBefore.bends);
    expect(after.lengthMm).toBe(lengthBefore);
  });

  it('ignores a wire that is not on the bench', () => {
    const { builder, board } = bench();
    const start = pinAt(builder, board.id, 'R_D2');
    const wire = builder.addWire(start.x, start.y, 300, 80);

    builder.setWireColour('w999', '#123456');

    expect(builder.build().wires[0].colour).toBe(wire.colour);
  });

  it('does not re-solve the circuit', () => {
    const simulation = new Simulation(esp32DevKitV1());
    simulation.addPart(esp32DevKitV1(), 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    const from = pinAt(simulation.builder, 'p1', 'R_D2');
    simulation.routeWire({ id: -1, ...from }, { id: -1, x: 300, y: 80 });
    const before = simulation.engine.currentNetlist.nodeCount;

    simulation.setWireColour(simulation.bench.wires[0].id, '#22c55e');

    // A full solve here would cost a circuit pass to produce the same answer.
    expect(simulation.engine.currentNetlist.nodeCount).toBe(before);
    expect(simulation.bench.wires[0].colour).toBe('#22c55e');
  });
});

describe('the palette', () => {
  it('has Wokwi ten numbered colours and then its extended set', () => {
    const labels = WIRE_COLOURS.map((colour) => colour.label);
    expect(labels.slice(0, 10)).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ]);
    expect(labels.length).toBeGreaterThan(10);
  });

  it('offers no duplicate hexes, or a swatch would be ambiguous', () => {
    const hexes = WIRE_COLOURS.map((colour) => colour.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('gives every swatch a border, so the dark ones are visible', () => {
    // Black on a dark bench is invisible without one, which is exactly the
    // colour a person picks to mean "not connected".
    for (const colour of WIRE_COLOURS) {
      expect(colour.border).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colour.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('defaults to a visible colour, not to black', () => {
    expect(DEFAULT_WIRE_COLOUR).not.toBe('#111111');
    expect(WIRE_COLOURS.some((colour) => colour.hex === DEFAULT_WIRE_COLOUR)).toBe(true);
  });

  it('never auto-assigns black or white', () => {
    // Both read as "no wire" and "highlighted" rather than as insulation, so
    // they stay selectable by hand but never turn up on their own.
    const assigned = Array.from({ length: 24 }, (_, i) => nextAutomaticWireColour(i));
    expect(assigned).not.toContain('#111111');
    expect(assigned).not.toContain('#e5e7eb');
  });

  it('gives consecutive wires different colours', () => {
    const first = nextAutomaticWireColour(0);
    const second = nextAutomaticWireColour(1);
    // A bench wired entirely in one colour is unreadable, which is the reason
    // this cycles rather than picking at random.
    expect(first).not.toBe(second);
  });
});
