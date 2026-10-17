import { describe, expect, it } from 'vitest';
import { BenchBuilder } from './bench';
import { esp32DevKitV1, rotateOffset } from '@/features/parts';
import { breadboardDefinition, columnX, stripRowY } from '@/features/parts';
import { buildNetlist } from './netlist';
import { NO_DYNAMIC_STATE } from '@/features/parts';

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

describe('lifting a part that was wired', () => {
  /*
   * A jumper clipped to a breadboard hole stays when a part is lifted, because
   * the hole holds it -- that is the test above. But a jumper clipped to the
   * *part's own pin* has nothing holding it once the part is gone, and leaving
   * it behind is what made repeated example loads pile up wires: the modules
   * vanished, the jumpers to their pins did not.
   */
  it('takes the wires clipped to the removed part with it', () => {
    const builder = new BenchBuilder();
    const board = builder.addPart(esp32DevKitV1(), 0, 0);
    builder.addPart(breadboardDefinition(), 200, 0);
    const holeX = 200 + columnX(2);
    const holeY = stripRowY(2);
    const pin = board.definition.pins.find((candidate) => candidate.id === 'R_D2')!;
    builder.addWire(holeX, holeY, pin.x, pin.y);
    expect(builder.build().wires).toHaveLength(1);

    builder.removePart(board.id);

    // The jumper's own contact survives at the hole; the jumper does not,
    // because the pin it was clipped to has left the bench.
    expect(builder.build().wires).toHaveLength(0);
  });

  it('leaves a wire whose both ends are still held', () => {
    const builder = new BenchBuilder();
    const board = builder.addPart(esp32DevKitV1(), 0, 0);
    builder.addPart(breadboardDefinition(), 200, 0);
    const holeX = 200 + columnX(2);
    const holeY = stripRowY(2);
    // Breadboard hole to open bench: neither end belongs to the board.
    builder.addWire(holeX, holeY, 320, 60);

    builder.removePart(board.id);

    expect(builder.build().wires).toHaveLength(1);
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


describe('taking a jumper off the bench', () => {
  it('removes only that wire', () => {
    const builder = new BenchBuilder();
    const doomed = builder.addWire(0, 0, 40, 20, { bends: [{ x: 20, y: 30 }] });
    const kept = builder.addWire(0, 0, 10, 60);

    builder.removeWire(doomed.id);

    expect(builder.build().wires.map((wire) => wire.id)).toEqual([kept.id]);
  });

  it('breaks the connection the wire was making', () => {
    const builder = new BenchBuilder();
    const board = builder.addPart(esp32DevKitV1(), 0, 0);
    const pin = board.definition.pins.find((candidate) => candidate.id === 'R_D2')!;
    const wire = builder.addWire(pin.x, pin.y, 60, 40);

    /** Every terminal sitting on the same net as the ESP32's pin. */
    const bridgedTo = (): readonly number[] => {
      const bench = builder.build();
      const pinTerminal = board.terminals.R_D2;
      const node = buildNetlist(bench, NO_DYNAMIC_STATE).nodeOfTerminal[pinTerminal];
      return buildNetlist(bench, NO_DYNAMIC_STATE).nets.find((net) => net.index === node)
        ?.terminals ?? [pinTerminal];
    };

    expect(bridgedTo().length).toBeGreaterThan(1);

    builder.removeWire(wire.id);

    /*
     * Pulling a jumper is how an operator disconnects two things, so the pin
     * has to end up bridged to nothing. Left linked, the solver would keep a
     * phantom connection after the wire that made it was pulled off the bench.
     */
    expect(builder.build().wires).toHaveLength(0);
    expect(bridgedTo()).toEqual([board.terminals.R_D2]);
  });

  it('releases the contacts only that wire was holding', () => {
    const builder = new BenchBuilder();
    const board = builder.addPart(esp32DevKitV1(), 0, 0);
    const pin = board.definition.pins.find((candidate) => candidate.id === 'R_D2')!;
    const loose = builder.addWire(0, 0, 60, 40);
    const held = builder.addWire(pin.x, pin.y, 80, 40);
    const terminalsBefore = builder.build().terminals.length;

    builder.removeWire(loose.id);

    const { wires, terminals } = builder.build();
    // The loose jumper's own contacts go with it...
    expect(terminals).toHaveLength(terminalsBefore - 2);
    // ...and the pin the surviving wire is clipped to keeps its own.
    expect(wires[0].id).toBe(held.id);
    expect(terminals[wires[0].from]).toBeDefined();
  });
});

describe('renaming a part', () => {
  it('stores a trimmed name and bumps the revision', () => {
    const builder = new BenchBuilder();
    const board = builder.addPart(esp32DevKitV1(), 0, 0);
    const before = builder.build().revision;
    builder.renamePart(board.id, '  Main board  ');
    const named = builder.build().parts.find((p) => p.id === board.id)!;
    expect(named.name).toBe('Main board');
    expect(builder.build().revision).toBeGreaterThan(before);
  });

  it('clears the name on blank input and ignores unknown ids', () => {
    const builder = new BenchBuilder();
    const board = builder.addPart(esp32DevKitV1(), 0, 0);
    builder.renamePart(board.id, 'Clock');
    builder.renamePart(board.id, '   ');
    expect(builder.build().parts.find((p) => p.id === board.id)!.name).toBeUndefined();
    expect(() => builder.renamePart('p999', 'Ghost')).not.toThrow();
  });
});

describe('painting a button cap', () => {
  it('stores a palette colour and bumps the revision', () => {
    const builder = new BenchBuilder();
    const board = builder.addPart(esp32DevKitV1(), 0, 0);
    const before = builder.build().revision;
    builder.setCapColour(board.id, '#22c55e');
    const painted = builder.build().parts.find((p) => p.id === board.id)!;
    expect(painted.capColour).toBe('#22c55e');
    expect(builder.build().revision).toBeGreaterThan(before);
  });

  it('ignores unknown colours and unknown ids', () => {
    const builder = new BenchBuilder();
    const board = builder.addPart(esp32DevKitV1(), 0, 0);
    builder.setCapColour(board.id, 'hotpink');
    builder.setCapColour(board.id, '#22c55g');
    expect(builder.build().parts.find((p) => p.id === board.id)!.capColour).toBeUndefined();
    expect(() => builder.setCapColour('p999', '#22c55e')).not.toThrow();
  });
});

describe('BenchBuilder id-accepting placement', () => {
  it('addPartWithId preserves the given id', () => {
    const b = new BenchBuilder();
    const part = b.addPartWithId('mcu', esp32DevKitV1(), 0, 0);
    expect(part.id).toBe('mcu');
  });

  it('addPartWithId with a pN id advances nextPartSerial past it', () => {
    const b = new BenchBuilder();
    b.addPartWithId('p5', esp32DevKitV1(), 0, 0);
    const next = b.addPart(esp32DevKitV1(), 10, 10);
    expect(next.id).toBe('p6');
  });

  it('addPartWithId falls back to a fresh id on collision', () => {
    const b = new BenchBuilder();
    b.addPartWithId('dup', esp32DevKitV1(), 0, 0);
    const second = b.addPartWithId('dup', esp32DevKitV1(), 10, 10);
    expect(second.id).not.toBe('dup');
    expect(b.build().parts.map((p) => p.id)).toContain('dup');
  });

  it('addWireWithId preserves the given id', () => {
    const b = new BenchBuilder();
    const p = b.addPartWithId('a', esp32DevKitV1(), 0, 0);
    const pinSpec = p.definition.pins[0];
    const off = rotateOffset(pinSpec.x, pinSpec.y, 0, p.definition.widthMm, p.definition.heightMm);
    const x = p.x + off.x;
    const y = p.y + off.y;
    const wire = b.addWireWithId('w9', x, y, x + 5, y + 5);
    expect(wire.id).toBe('w9');
  });
});
