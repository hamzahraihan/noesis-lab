import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { routeWireViaCorners, type Point } from './wire-route';
import { esp32DevKitV1 } from '@/features/parts';
import { breadboardDefinition } from '@/features/parts';

/**
 * Choosing where a new waypoint goes.
 *
 * A wire is described by two lists of different lengths. `wire.bends` holds the
 * waypoints the operator placed, and `routeWireViaCorners` returns every corner
 * the wire turns at -- both contacts, every bend, plus the extra corners the
 * router adds so that no run moves on both axes at once. The corners list is
 * therefore always the longer one, and its final leg has no bend index at all
 * because it ends at the far contact.
 *
 * An index into one is not an index into the other. Conflating them fails
 * silently: the waypoint is accepted, the wire redraws, and it appears on the
 * wrong leg with nothing to say why -- a handle sitting off in empty space.
 */
function benchWithBentWire() {
  const simulation = new Simulation(esp32DevKitV1());
  simulation.addPart(esp32DevKitV1(), 0, 0);
  simulation.addPart(breadboardDefinition(), 230, 0);
  simulation.routeWire({ x: 10, y: 10 } as never, { x: 90, y: 60 } as never, [
    { x: 45, y: 10 },
    { x: 45, y: 45 },
  ]);
  const wire = simulation.bench.wires[0];
  const from = simulation.bench.terminals[wire.from];
  const to = simulation.bench.terminals[wire.to];
  return {
    simulation,
    wire,
    corners: routeWireViaCorners(from, wire.bends, to),
  };
}

const midpointOf = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

describe('bendIndexNear', () => {
  it('always returns a legal slot in the bends list', () => {
    const { simulation, wire, corners } = benchWithBentWire();

    for (let leg = 0; leg < corners.length - 1; leg++) {
      const middle = midpointOf(corners[leg], corners[leg + 1]);
      const index = simulation.bendIndexNear(wire.id, middle.x, middle.y);

      // The corners list is longer than the bends list, so an untranslated
      // index would run past the end and be clamped -- which is precisely the
      // behaviour that put waypoints on the wrong leg.
      expect(index, `leg ${leg}`).toBeGreaterThanOrEqual(0);
      expect(index, `leg ${leg}`).toBeLessThanOrEqual(wire.bends.length);
    }
  });

  it('sends a waypoint clicked on an early leg to the front of the list', () => {
    const { simulation, wire, corners } = benchWithBentWire();
    const middle = midpointOf(corners[0], corners[1]);

    expect(simulation.bendIndexNear(wire.id, middle.x, middle.y)).toBe(0);
  });

  it('sends a waypoint clicked on the last leg to the end of the list', () => {
    const { simulation, wire, corners } = benchWithBentWire();
    // The last leg runs from the final bend towards the far contact. Untranslated
    // this reported one past the end of the bends list.
    const middle = midpointOf(corners[corners.length - 2], corners[corners.length - 1]);

    expect(simulation.bendIndexNear(wire.id, middle.x, middle.y)).toBe(wire.bends.length);
  });

  it('has a distinct slot for every leg it can be clicked on', () => {
    const { simulation, wire, corners } = benchWithBentWire();
    const indices = corners.slice(0, -1).map((corner, leg) => {
      const middle = midpointOf(corner, corners[leg + 1]);
      return simulation.bendIndexNear(wire.id, middle.x, middle.y);
    });

    // Monotonic, and spanning the whole list: each leg maps to a later slot than
    // the one before it, so a waypoint lands in the order the wire was drawn.
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(wire.bends.length);
  });

  it('returns 0 for a wire that is not on the bench', () => {
    const simulation = new Simulation(esp32DevKitV1());
    expect(simulation.bendIndexNear('p999', 10, 10)).toBe(0);
  });
});

describe('inserting a waypoint', () => {
  it('puts the waypoint where the pointer was, not at the far end', () => {
    const { simulation, wire, corners } = benchWithBentWire();
    const before = [...wire.bends];

    // Click the first leg: the new waypoint belongs at the front, so the wire
    // should gain a corner near where the pointer was rather than at the end.
    const middle = midpointOf(corners[0], corners[1]);
    const index = simulation.bendIndexNear(wire.id, middle.x, middle.y);
    simulation.insertWireBend(wire.id, index, { x: 25, y: 10 });

    const after = simulation.bench.wires[0].bends;
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toEqual({ x: 25, y: 10 });
  });

  it('keeps the waypoint on the drawn path', () => {
    const { simulation, wire, corners } = benchWithBentWire();
    const middle = midpointOf(corners[0], corners[1]);
    simulation.insertWireBend(
      wire.id,
      simulation.bendIndexNear(wire.id, middle.x, middle.y),
      { x: 25, y: 10 },
    );

    const updated = simulation.bench.wires[0];
    const from = simulation.bench.terminals[updated.from];
    const to = simulation.bench.terminals[updated.to];
    const path = routeWireViaCorners(from, updated.bends, to);

    // The invariant behind the whole gesture: a handle the operator can see and
    // drag must sit on the wire, not beside it.
    expect(path).toContainEqual({ x: 25, y: 10 });
  });
});
