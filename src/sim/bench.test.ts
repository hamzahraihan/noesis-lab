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
