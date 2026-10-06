import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { esp32DevKitV1 } from '../sim/boards';
import { breadboardDefinition } from '../sim/breadboard';
import { resistorDefinition } from '../sim/passives';

/**
 * Undo and redo.
 *
 * The bench is snapshotted rather than reversed operation by operation, so what
 * these check is the promise that a snapshot makes: whatever the operator did,
 * stepping back and forward again returns the bench to exactly where it was.
 */

function bench() {
  const simulation = new Simulation(esp32DevKitV1());
  simulation.addPart(breadboardDefinition(), 230, 0);
  return simulation;
}
/** The id of the jumper most recently routed, since routing returns nothing. */
function newestWire(simulation: Simulation): string {
  const wires = simulation.bench.wires;
  return wires[wires.length - 1].id;
}

describe('undo and redo', () => {
  it('brings back a wire that was deleted', () => {
    const simulation = bench();
    simulation.routeWire({ id: -1, x: 20, y: 20 }, { id: -1, x: 60, y: 20 });
    const wire = newestWire(simulation);
    simulation.removeWire(wire);
    expect(simulation.bench.wires).toHaveLength(0);

    expect(simulation.undo()).toBe(true);

    // Not merely "a wire is back" -- the same wire, clipped where it was.
    const restored = simulation.bench.wires[0];
    expect(restored.id).toBe(wire);
    const terminals = simulation.bench.terminals;
    expect(terminals[restored.from].x).toBeCloseTo(20, 6);
    expect(terminals[restored.to].y).toBeCloseTo(20, 6);
  });

  it('steps forward again to where it was', () => {
    const simulation = bench();
    simulation.routeWire({ id: -1, x: 20, y: 20 }, { id: -1, x: 60, y: 20 });
    // The bench's contents, without its change counter. `revision` counts
    // mutations rather than describing the bench, and an undo *is* a mutation,
    // so comparing it would assert that undo changes nothing at all -- which is
    // the opposite of what an undo is for.
    const contents = () => JSON.stringify({ ...simulation.bench, revision: 0 });
    const before = contents();

    simulation.removeWire(newestWire(simulation));
    const afterEdit = contents();

    simulation.undo();
    // Not merely "a wire is back" -- the bench as it was, field for field. If
    // the snapshot lost something, a wire's measured length or a contact's
    // position, this is where it would show.
    expect(contents()).toBe(before);

    expect(simulation.redo()).toBe(true);
    // And forward again to the state the deletion left behind, which is a
    // different bench: the loose contacts the wire was holding are released.
    expect(contents()).toBe(afterEdit);
  });

  it('steps a drag back to where it started, not to a frame of it', () => {
    // No breadboard: the history has to be empty for "one step back" to mean
    // "before the drag" rather than "before whatever came before it".
    const simulation = new Simulation(esp32DevKitV1());
    const part = simulation.addPart(resistorDefinition(220), 40, 40);
    simulation.movePart(part.id, 44, 44);
    simulation.movePart(part.id, 48, 48);

    const moved = simulation.bench.parts.find((candidate) => candidate.id === part.id)!;
    expect([moved.x, moved.y]).toEqual([48, 48]);

    simulation.undo();

    const undone = simulation.bench.parts.find((candidate) => candidate.id === part.id)!;
    expect([undone.x, undone.y]).toEqual([40, 40]);
  });

  it('collapses a whole drag into one step', () => {
    const simulation = new Simulation(esp32DevKitV1());
    const part = simulation.addPart(resistorDefinition(220), 40, 40);
    // A drag calls into the model on every animation frame. If each of these
    // were its own undo step, one Ctrl+Z would walk back through the drag a
    // frame at a time and the operator would have to press it twenty times.
    for (let i = 1; i <= 20; i++) simulation.movePart(part.id, 40 + i, 40 + i);

    expect(simulation.undo()).toBe(true);
    const once = simulation.bench.parts.find((candidate) => candidate.id === part.id)!;
    expect([once.x, once.y]).toEqual([40, 40]);

    // The drag was one edit, so one more step goes back past it to before the
    // part was placed -- and then there is nothing left at all.
    expect(simulation.undo()).toBe(true);
    expect(simulation.bench.parts).toHaveLength(0);
    expect(simulation.canUndo()).toBe(false);
    expect(simulation.undo()).toBe(false);
  });

  it('keeps two separate wire deletions as separate steps', () => {
    const simulation = bench();
    simulation.routeWire({ id: -1, x: 20, y: 20 }, { id: -1, x: 60, y: 20 });
    const first = newestWire(simulation);
    simulation.routeWire({ id: -1, x: 20, y: 40 }, { id: -1, x: 60, y: 40 });
    const second = newestWire(simulation);

    simulation.removeWire(second);
    simulation.removeWire(first);
    expect(simulation.bench.wires).toHaveLength(0);

    // One step brings back the first deletion, not both at once.
    simulation.undo();
    expect(simulation.bench.wires.map((w) => w.id)).toEqual([first]);
  });

  it('forgets the future once the bench is edited again', () => {
    const simulation = bench();
    simulation.routeWire({ id: -1, x: 20, y: 20 }, { id: -1, x: 60, y: 20 });
    simulation.removeWire(newestWire(simulation));
    simulation.undo();
    expect(simulation.canRedo()).toBe(true);

    simulation.routeWire({ id: -1, x: 20, y: 80 }, { id: -1, x: 60, y: 80 });

    // Redoing now would invent a wire the operator never drew, in a bench that
    // has moved on since. The future is dropped the moment the past changes.
    expect(simulation.canRedo()).toBe(false);
    expect(simulation.redo()).toBe(false);
  });

  it('does nothing on an empty history', () => {
    // No parts placed: the starter bench is already an edit that could be
    // stepped back from, and the point here is the very first press of the key.
    const simulation = new Simulation(esp32DevKitV1());
    const before = JSON.stringify(simulation.bench);

    expect(simulation.canUndo()).toBe(false);
    expect(simulation.canRedo()).toBe(false);
    expect(simulation.undo()).toBe(false);
    expect(simulation.redo()).toBe(false);
    expect(JSON.stringify(simulation.bench)).toBe(before);
  });

  it('restores a part removed with its wires', () => {
    const simulation = bench();
    const part = simulation.addPart(resistorDefinition(220), 40, 40);
    simulation.routeWire({ id: -1, x: 44, y: 44 }, { id: -1, x: 80, y: 44 });

    simulation.removePart(part.id);
    expect(simulation.bench.parts.some((candidate) => candidate.id === part.id)).toBe(false);

    simulation.undo();

    const back = simulation.bench.parts.find((candidate) => candidate.id === part.id);
    expect(back).toBeDefined();
    // The wire came with it. `removePart` takes a part's wires off the bench,
    // so an undo that restored only the part would leave it unwired.
    expect(simulation.bench.wires.length).toBeGreaterThan(0);
  });

  it('never hands out a part id the bench is still using', () => {
    const simulation = bench();
    // Undo and re-place the same part several times. The id counters ride along
    // in every snapshot, so a restore that got them wrong would eventually let
    // a new part take an id a live part already holds -- and everything that
    // looks a part up by id would then have two answers.
    for (let i = 0; i < 4; i++) {
      const part = simulation.addPart(resistorDefinition(220), 40, 40);
      const ids = simulation.bench.parts.map((candidate) => candidate.id);
      expect(ids).toHaveLength(new Set(ids).size);
      simulation.undo();
      expect(simulation.bench.parts.some((candidate) => candidate.id === part.id)).toBe(false);
    }
  });
});
