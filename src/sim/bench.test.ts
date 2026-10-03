import { describe, expect, it } from 'vitest';
import { BenchBuilder } from './bench';
import { esp32DevKitV1 } from './boards';
import { breadboardDefinition, columnX, stripRowY } from './breadboard';

/**
 * A bench holds one contact per pin and one per jumper end, and nothing else.
 *
 * All three tests below failed the same way before contacts were owned by
 * their pins: a drag re-resolved every pin against the bench and claimed a
 * fresh contact wherever it landed, so the contact count tracked how far the
 * mouse had travelled, and every jumper was left behind at the coordinates it
 * was first drawn at.
 */

/** A board with one jumper running from a header pin out to open bench. */
function wiredBench() {
  const builder = new BenchBuilder();
  const board = builder.addPart(esp32DevKitV1(), 0, 0);
  const pin = board.definition.pins.find((candidate) => candidate.id === 'R_D2')!;
  const wire = builder.addWire(pin.x, pin.y, 60, 40);
  return { builder, board, wire };
}

describe('dragging a part', () => {
  it('allocates no contacts, however far the part travels', () => {
    const { builder, board } = wiredBench();
    const before = builder.build().terminals.length;

    // A pointer drag arrives as a stream of small steps, so this is what a real
    // drag does: many moves, none of which may leave anything behind.
    for (let step = 1; step <= 60; step++) {
      builder.movePart(board.id, board.x + step, board.y + step * 0.5);
    }

    expect(builder.build().terminals.length).toBe(before);
  });

  it('carries a jumper clipped to its pin along with it', () => {
    const { builder, board, wire } = wiredBench();
    const start = { ...builder.build().terminals[wire.from] };

    builder.movePart(board.id, 25, 15);
    const moved = builder.build().terminals[wire.from];

    // The jumper still ends on the pin it was clipped to, at the pin's new
    // place, rather than staying behind at the header.
    expect(moved.x).toBeCloseTo(start.x + 25, 6);
    expect(moved.y).toBeCloseTo(start.y + 15, 6);
  });

  it('leaves a jumper in a breadboard hole when the part is lifted out', () => {
    const builder = new BenchBuilder();
    const board = builder.addPart(esp32DevKitV1(), 0, 0);
    builder.addPart(breadboardDefinition(), 200, 0);
    const holeX = 200 + columnX(2);
    const holeY = stripRowY(2);
    const wire = builder.addWire(holeX, holeY, 300, 40);
    const before = builder.build().terminals.length;

    builder.removePart(board.id);
    const after = builder.build();

    // Pulling a jumper out of a header does not take the hole's contact with
    // it, and the contacts the board alone was holding are handed back rather
    // than left stranded on the bench.
    expect(after.terminals[wire.from].x).toBeCloseTo(holeX, 6);
    expect(after.terminals[wire.from].y).toBeCloseTo(holeY, 6);
    expect(after.terminals.length).toBeLessThan(before);
  });
});

describe('hand-placed bends', () => {
  it('defaults to none, so existing wires take the automatic route', () => {
    const { wire } = wiredBench();
    expect(wire.bends).toEqual([]);
  });

  it('keeps the bends it was given', () => {
    const builder = new BenchBuilder();
    const bends = [
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];
    builder.addWire(0, 0, 40, 20, { bends });

    expect(builder.build().wires[0].bends).toEqual(bends);
  });

  it('measures a bent wire along the path it runs, not end to end', () => {
    // A Z between contacts 40 mm apart: 20 across, 20 down, 20 across.
    const bent = new BenchBuilder().addWire(0, 0, 40, 20, {
      bends: [
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
    });
    // 60 mm of wire, not the 44.7 mm straight line between the same points.
    // The solver turns this into resistance, so measuring end-to-end would
    // quietly understate what a real bent jumper measures.
    expect(bent.lengthMm).toBeCloseTo(60, 6);
    expect(bent.lengthMm).toBeGreaterThan(Math.hypot(40, 20));
  });

  it('still joins the same two contacts, however it is bent', () => {
    const builder = new BenchBuilder();
    const straight = builder.addWire(0, 0, 40, 20);
    const bent = new BenchBuilder().addWire(0, 0, 40, 20, {
      bends: [{ x: 10, y: 40 }, { x: 30, y: 40 }],
    });

    // Bends are a routing detail. The netlist unions a wire's two ends
    // regardless of where it runs, so a bent wire must connect exactly what a
    // straight one would.
    expect(bent.from).toBe(straight.from);
    expect(bent.to).toBe(straight.to);
  });

  it('copies the bends rather than aliasing the caller list', () => {
    const builder = new BenchBuilder();
    const bends: Array<{ x: number; y: number }> = [{ x: 20, y: 0 }];
    builder.addWire(0, 0, 40, 20, { bends });

    // The builder hands the array straight back on `build()`, so a caller
    // mutating its own list afterwards must not redraw wires already placed.
    bends.push({ x: 30, y: 0 });
    expect(builder.build().wires[0].bends).toHaveLength(1);
  });
});

describe('reshaping a placed wire', () => {
  /**
   * A wire that runs down, back up past its own level, then along.
   *
   * The doubling-back matters. A bend list that merely detours leaves the
   * length identical under removal -- the wire drops one dogleg but gains the
   * same one back -- so those tests would pass without ever proving the
   * re-measure happens. This shape's length genuinely depends on the bends.
   */
  function bentWire() {
    const builder = new BenchBuilder();
    const wire = builder.addWire(0, 0, 40, 0, {
      bends: [
        { x: 20, y: 20 },
        { x: 20, y: 10 },
      ],
    });
    return { builder, wire };
  }

  it('moves a waypoint and re-measures the wire', () => {
    const { builder, wire } = bentWire();
    const before = wire.lengthMm;

    // Collapsing the back-and-forth into a single waypoint at half the height
    // shortens the run from 80 mm to 50 mm.
    builder.setWireBends(wire.id, [
      { x: 20, y: 5 },
      { x: 20, y: 5 },
    ]);

    const after = builder.build().wires[0];
    expect(after.bends[0]).toEqual({ x: 20, y: 5 });
    // The wire got shorter, and resistance is computed from this number, so a
    // stale length here would price a reshaped jumper at its old resistance.
    expect(after.lengthMm).toBeCloseTo(50, 6);
    expect(after.lengthMm).toBeLessThan(before);
  });

  it('returns a wire to the automatic route when its bends are cleared', () => {
    const { builder, wire } = bentWire();
    builder.setWireBends(wire.id, []);

    // Empty is not "a wire with no corners drawn" -- it is the signal the
    // renderer uses to fall back to the lane-separated dogleg.
    expect(builder.build().wires[0].bends).toEqual([]);
  });

  it('removes one waypoint and keeps the rest in order', () => {
    const { builder, wire } = bentWire();
    builder.removeWireBend(wire.id, 0);

    const bends = builder.build().wires[0].bends;
    expect(bends).toHaveLength(1);
    expect(bends[0]).toEqual({ x: 20, y: 10 });
  });

  it('ignores a removal of a waypoint that is not there', () => {
    const { builder, wire } = bentWire();
    builder.removeWireBend(wire.id, 9);
    builder.removeWireBend('nope', 0);

    // An out-of-range index from a drag must not silently drop the wrong bend.
    expect(builder.build().wires[0].bends).toHaveLength(2);
  });

  it('inserts a waypoint at the leg it was asked for, not at the end', () => {
    const { builder, wire } = bentWire();
    builder.insertWireBend(wire.id, 0, { x: 5, y: 0 });

    // Order is what defines the wire's shape, so inserting at a leg index is
    // what puts a waypoint where it was clicked rather than always last.
    const bends = builder.build().wires[0].bends;
    expect(bends).toHaveLength(3);
    expect(bends[0]).toEqual({ x: 5, y: 0 });
  });

  it('clamps an insertion past the end rather than leaving a hole', () => {
    const { builder, wire } = bentWire();
    builder.insertWireBend(wire.id, 99, { x: 30, y: 20 });

    const bends = builder.build().wires[0].bends;
    expect(bends).toHaveLength(3);
    expect(bends[2]).toEqual({ x: 30, y: 20 });
  });

  it('re-measures after a removal, not just a move', () => {
    const { builder, wire } = bentWire();
    // 20 down, 10 back up, 20 across, 20 down again, 10 up: 80 mm of wire.
    const before = builder.build().wires[0].lengthMm;
    expect(before).toBeCloseTo(80, 6);

    builder.removeWireBend(wire.id, 0);
    const after = builder.build().wires[0].lengthMm;

    // Dropping a waypoint cannot lengthen a wire; if it did, the resistance
    // would drift every time a bend was tidied away.
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(60, 6);
  });
});
