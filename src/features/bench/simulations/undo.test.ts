import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import {
  breadboardDefinition,
  esp32DevKitV1,
  partDefinitionById,
  resistorDefinition,
} from '@/features/parts';
import { BUTTON_CAP_COLOURS, type Terminal } from '@/features/simulation';

/**
 * Undo, redo and the document behind both.
 *
 * The circuit document is the live state: an edit is an operation over it, the
 * bench is compiled from the result, and the history is a stack of documents.
 * What these check is the promise that makes that safe -- stepping back and
 * forward returns the circuit field for field, and the document always
 * describes the bench drawn beside it.
 */

function bench(): Simulation {
  const simulation = new Simulation(esp32DevKitV1());
  simulation.addPart(esp32DevKitV1(), 0, 0);
  simulation.addPart(breadboardDefinition(), 230, 0);
  return simulation;
}

/** A real board pin, so a routed wire lands somewhere a document can name. */
function boardPin(simulation: Simulation, pinId: string): Terminal {
  const board = simulation.bench.parts.find((part) => part.definition.component.kind === 'mcu')!;
  return simulation.pinAt(board, pinId)!;
}

function partPin(simulation: Simulation, partId: string, pinId: string): Terminal {
  const part = simulation.bench.parts.find((candidate) => candidate.id === partId)!;
  return simulation.pinAt(part, pinId)!;
}

/** Routes a jumper between two board pins and returns its id. */
function route(simulation: Simulation, from: string, to: string): string {
  simulation.routeWire(boardPin(simulation, from), boardPin(simulation, to));
  const wires = simulation.bench.wires;
  return wires[wires.length - 1]!.id;
}

describe('undo and redo', () => {
  it('brings back a wire that was deleted', () => {
    const simulation = bench();
    const wire = route(simulation, 'R_D5', 'R_D15');
    simulation.removeWire(wire);
    expect(simulation.bench.wires).toHaveLength(0);

    expect(simulation.undo()).toBe(true);

    // Not merely "a wire is back" -- the same wire, clipped where it was.
    const restored = simulation.bench.wires[0];
    expect(restored.id).toBe(wire);
    const terminals = simulation.bench.terminals;
    expect(terminals[restored.from].x).toBeCloseTo(boardPin(simulation, 'R_D5').x, 6);
    expect(terminals[restored.to].y).toBeCloseTo(boardPin(simulation, 'R_D15').y, 6);
  });

  it('steps forward again to where it was', () => {
    const simulation = bench();
    route(simulation, 'R_D5', 'R_D15');
    // The bench's contents, without its change counter. `revision` counts
    // mutations rather than describing the bench, and an undo *is* a mutation,
    // so comparing it would assert that undo changes nothing at all -- which is
    // the opposite of what an undo is for.
    const contents = () => JSON.stringify({ ...simulation.bench, revision: 0 });
    const before = contents();

    simulation.removeWire(simulation.bench.wires[0].id);
    const afterEdit = contents();

    simulation.undo();
    // Not merely "a wire is back" -- the bench as it was, field for field. If
    // the document lost something, a wire's measured length or a contact's
    // position, this is where it would show.
    expect(contents()).toBe(before);

    expect(simulation.redo()).toBe(true);
    expect(contents()).toBe(afterEdit);
  });

  it('steps a drag back to where it started, not to a frame of it', () => {
    const simulation = new Simulation(esp32DevKitV1());
    const part = simulation.addPart(resistorDefinition(220), 40, 40);
    simulation.beginGesture('part-move', part.id);
    simulation.movePart(part.id, 44, 44);
    simulation.movePart(part.id, 48, 48);
    simulation.endGesture();

    const moved = simulation.bench.parts.find((candidate) => candidate.id === part.id)!;
    expect([moved.x, moved.y]).toEqual([48, 48]);

    simulation.undo();

    const undone = simulation.bench.parts.find((candidate) => candidate.id === part.id)!;
    expect([undone.x, undone.y]).toEqual([40, 40]);
  });

  it('collapses a whole drag into one step', () => {
    const simulation = new Simulation(esp32DevKitV1());
    const part = simulation.addPart(resistorDefinition(220), 40, 40);
    // A drag calls into the model on every animation frame. It is written to
    // the document once, on release, so it is one undo step.
    simulation.beginGesture('part-move', part.id);
    for (let i = 1; i <= 20; i++) simulation.movePart(part.id, 40 + i, 40 + i);
    simulation.endGesture();

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

  it('writes a drag to the document on release, not per frame', () => {
    const simulation = new Simulation(esp32DevKitV1());
    const part = simulation.addPart(resistorDefinition(220), 40, 40);
    simulation.beginGesture('part-move', part.id);
    simulation.movePart(part.id, 50, 50);

    // Mid-drag the bench leads: the drag holds terminal objects a compile would
    // renumber, so the document is only written when the gesture ends.
    const during = simulation.document.parts.find((candidate) => candidate.id === part.id)!;
    expect([during.x, during.y]).toEqual([40, 40]);

    simulation.endGesture();
    const after = simulation.document.parts.find((candidate) => candidate.id === part.id)!;
    expect([after.x, after.y]).toEqual([50, 50]);
  });

  it('records every structural edit in the document', () => {
    const simulation = bench();
    const part = simulation.addPart(resistorDefinition(220), 40, 40);
    route(simulation, 'R_D5', 'R_D15');
    simulation.rotatePart(part.id);
    simulation.renamePart(part.id, 'Load');
    simulation.setCapColour(part.id, BUTTON_CAP_COLOURS[0]!);

    const doc = simulation.document;
    expect(doc.parts.find((candidate) => candidate.id === part.id)).toMatchObject({
      rotation: 90,
      name: 'Load',
      capColour: BUTTON_CAP_COLOURS[0],
    });
    expect(doc.wires).toHaveLength(1);
    expect(doc.wires[0]).toMatchObject({ from: 'p1:D5', to: 'p1:D15' });
  });

  it('makes a rename and a cap colour undoable', () => {
    const simulation = new Simulation(esp32DevKitV1());
    const part = simulation.addPart(resistorDefinition(220), 40, 40);
    simulation.renamePart(part.id, 'Load');
    simulation.setCapColour(part.id, BUTTON_CAP_COLOURS[0]!);

    expect(simulation.document.parts.find((candidate) => candidate.id === part.id)).toMatchObject({
      name: 'Load',
      capColour: BUTTON_CAP_COLOURS[0],
    });

    simulation.undo();
    expect(simulation.document.parts.find((candidate) => candidate.id === part.id)).toMatchObject({
      name: 'Load',
    });
    expect(
      simulation.document.parts.find((candidate) => candidate.id === part.id)?.capColour,
    ).toBeUndefined();

    simulation.undo();
    expect(
      simulation.document.parts.find((candidate) => candidate.id === part.id)?.name,
    ).toBeUndefined();
  });

  it('records a knob without making it undoable', () => {
    const simulation = new Simulation(esp32DevKitV1());
    const part = simulation.addPart(partDefinitionById('slide-potentiometer')!, 40, 40);
    const spec = simulation.bench.parts.find((candidate) => candidate.id === part.id)!.definition
      .knobs![0]!;

    simulation.setKnob(part.id, spec, spec.max);

    expect(simulation.document.state?.knobs?.[`${part.id}:${spec.id}`]).toBe(spec.max);
    // A knob is operator state, not wiring: the undo below steps back over the
    // part's placement, which is the edit before the turn.
    simulation.undo();
    expect(simulation.bench.parts.some((candidate) => candidate.id === part.id)).toBe(false);
  });

  it('refuses a wire whose end is not a pin', () => {
    const simulation = bench();
    simulation.routeWire({ id: -1, x: 5, y: 5 }, boardPin(simulation, 'R_D5'));
    // A dangling end cannot be expressed by a document, so it is not drawn at
    // all rather than drawn and silently lost on save.
    expect(simulation.bench.wires).toHaveLength(0);
  });

  it('springs a wire back when a drag ends between pins', () => {
    const simulation = bench();
    const wire = route(simulation, 'R_D5', 'R_D15');
    const before = simulation.document.wires[0]!;

    simulation.beginGesture('wire-end', wire, 'to');
    simulation.moveWireEnd(wire, 'to', { id: -1, x: 5, y: 5 });
    simulation.endGesture();

    // The document never saw the loose end, and the bench was recomputed from
    // it: the wire is back on the pin it was clipped to.
    expect(simulation.document.wires[0]).toEqual(before);
    const terminal = simulation.bench.terminals[simulation.bench.wires[0]!.to];
    const pin = boardPin(simulation, 'R_D15');
    expect(terminal.x).toBeCloseTo(pin.x, 6);
    expect(terminal.y).toBeCloseTo(pin.y, 6);
  });

  it('loads a document as the live state', () => {
    const simulation = new Simulation(esp32DevKitV1());
    const doc = {
      version: 1,
      parts: [
        { id: 'p1', type: 'esp32-devkit-v1', x: 0, y: 0, rotation: 0 as const },
        { id: 'p2', type: 'resistor-220', x: 40, y: 40, rotation: 0 as const },
      ],
      wires: [
        {
          id: 'w1',
          from: 'p1:R_D5',
          to: 'p2:a',
          colour: '#d94f4f',
          gaugeAwg: 26,
          bends: [],
        },
      ],
    };
    expect(simulation.loadCircuit(doc)).toEqual([]);
    expect(simulation.document).toEqual(doc);
    expect(simulation.canUndo()).toBe(false);
  });

  it('keeps two separate wire deletions as separate steps', () => {
    const simulation = bench();
    const first = route(simulation, 'R_D5', 'R_D15');
    const second = route(simulation, 'R_D18', 'R_D23');

    simulation.removeWire(second);
    simulation.removeWire(first);
    expect(simulation.bench.wires).toHaveLength(0);

    // One step brings back the first deletion, not both at once.
    simulation.undo();
    expect(simulation.bench.wires.map((wire) => wire.id)).toEqual([first]);
  });

  it('forgets the future once the bench is edited again', () => {
    const simulation = bench();
    route(simulation, 'R_D5', 'R_D15');
    simulation.removeWire(simulation.bench.wires[0].id);
    simulation.undo();
    expect(simulation.canRedo()).toBe(true);

    route(simulation, 'R_D18', 'R_D23');

    // Redoing now would invent a wire the operator never drew, in a bench that
    // has moved on since. The future is dropped the moment the past changes.
    expect(simulation.canRedo()).toBe(false);
    expect(simulation.redo()).toBe(false);
  });

  it('does nothing on an empty history', () => {
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
    simulation.routeWire(boardPin(simulation, 'R_D5'), partPin(simulation, part.id, 'a'));

    simulation.removePart(part.id);
    expect(simulation.bench.parts.some((candidate) => candidate.id === part.id)).toBe(false);
    expect(simulation.bench.wires).toHaveLength(0);

    simulation.undo();

    expect(simulation.bench.parts.some((candidate) => candidate.id === part.id)).toBe(true);
    // The wire came with it. `removePart` takes a part's wires off the bench,
    // so an undo that restored only the part would leave it unwired.
    expect(simulation.bench.wires).toHaveLength(1);
    expect(simulation.document.wires).toHaveLength(1);
  });

  it('never hands out a part id the bench is still using', () => {
    const simulation = bench();
    // Undo and re-place the same part several times. The document carries the
    // ids, so a new part takes the next serial over what is live -- never one a
    // part already holds, and the same one the undone part had.
    for (let i = 0; i < 4; i++) {
      const part = simulation.addPart(resistorDefinition(220), 40, 40);
      const ids = simulation.bench.parts.map((candidate) => candidate.id);
      expect(ids).toHaveLength(new Set(ids).size);
      simulation.undo();
      expect(simulation.bench.parts.some((candidate) => candidate.id === part.id)).toBe(false);
    }
  });

  it('steps a quarter turn back, and takes nothing else with it', () => {
    const simulation = bench();
    route(simulation, 'R_D5', 'R_D15');
    const part = simulation.addPart(resistorDefinition(220), 40, 80);

    simulation.rotatePart(part.id);
    expect(simulation.partRotation(part.id)).toBe(90);

    // Turning a part is an edit like any other. If the turn itself were not in
    // the history, this undo would step back over the part's placement instead
    // -- and on a freshly loaded project, over the project's own last wire.
    expect(simulation.undo()).toBe(true);
    expect(simulation.bench.parts.some((candidate) => candidate.id === part.id)).toBe(true);
    expect(simulation.partRotation(part.id)).toBe(0);
    expect(simulation.bench.wires).toHaveLength(1);
  });

  it('forgets the history of a bench that was just built', () => {
    // Building a bench goes through the same methods the operator edits with,
    // so it pushes history like any other change. Forgetting that history is
    // what keeps the first Ctrl+Z from pulling apart a project that was just
    // loaded and never touched.
    const simulation = bench();
    expect(simulation.canUndo()).toBe(true);

    simulation.clearHistory();

    expect(simulation.canUndo()).toBe(false);
    expect(simulation.canRedo()).toBe(false);
    expect(simulation.undo()).toBe(false);
    expect(simulation.redo()).toBe(false);

    // And edits after the reset are stepped back as usual.
    route(simulation, 'R_D5', 'R_D15');
    expect(simulation.canUndo()).toBe(true);
    simulation.undo();
    expect(simulation.bench.wires).toHaveLength(0);
  });
});
