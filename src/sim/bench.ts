/**
 * The physical bench: parts placed on a surface, jumper wires between them.
 *
 * A `Terminal` is one real contact point -- a breadboard hole, a header pin, a
 * wire end. Every part pin owns exactly one from the moment it is placed, and
 * that terminal travels with the part, so dragging a board carries its pins
 * and a jumper clipped to one keeps its grip. A jumper end dropped on an
 * occupied hole shares that hole's terminal, which is precisely what sharing
 * one breadboard column means. Contacts that merely land on the same spot are
 * joined electrically by the netlist rather than by sharing an id, so two
 * parts can straddle one hole without collapsing into a single part.
 *
 * Ownership is also what bounds the contact count. Nothing is ever allocated
 * during a drag: a move carries the terminals the part already holds, and
 * lifting a part releases the ones nothing else holds. The count therefore
 * tracks what is on the bench rather than how far a mouse has travelled.
 *
 * Positions are mutable on purpose. Dragging a part updates it in place,
 * which is far cheaper than rebuilding the bench and keeps part identity --
 * and therefore firmware state -- stable across a drag.
 */

import { type PartDefinition, type Rotation, rotateOffset } from './catalog';

/**
 * A bend position, in millimetres.
 *
 * Declared here rather than imported so the bench model stays independent of
 * the UI's geometry types; the shape is the same and structurally compatible.
 */
export interface BendPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * How close two contacts must be to count as sharing one hole.
 *
 * Exported because the netlist needs the same number to decide which contacts
 * are physically joined; two tolerances that drift apart would wire a bench
 * that the picker cannot see.
 */
export const SNAP_DISTANCE_MM = 0.4;

/**
 * Length of the path a jumper actually runs, in millimetres.
 *
 * With no bends this is the straight line between the contacts. With them it
 * sums the legs, and each leg is measured along the same orthogonal path the
 * renderer draws -- so the resistance the solver uses is the length of the
 * wire on the bench, not the distance between where its ends happen to sit.
 */
function routedLengthMm(
  fromX: number,
  fromY: number,
  bends: readonly BendPoint[],
  toX: number,
  toY: number,
): number {
  let total = 0;
  let x = fromX;
  let y = fromY;

  for (const bend of bends) {
    // A leg whose ends do not line up is drawn as two runs, so it is measured
    // as two; see `legCorners` in the router.
    if (x !== bend.x && y !== bend.y) total += Math.abs(bend.x - x) + Math.abs(bend.y - y);
    else total += Math.hypot(bend.x - x, bend.y - y);
    x = bend.x;
    y = bend.y;
  }

  if (x !== toX && y !== toY) total += Math.abs(toX - x) + Math.abs(toY - y);
  else total += Math.hypot(toX - x, toY - y);

  return total;
}

export interface Terminal {
  readonly id: number;
  /** Bench millimetres. Moves only when the contact's owner does. */
  x: number;
  y: number;
}

export interface PartInstance {
  readonly id: string;
  readonly definition: PartDefinition;
  x: number;
  y: number;
  rotation: Rotation;
  /** Header pin id to the terminal it occupies. */
  readonly terminals: Record<string, number>;
}

export interface Wire {
  readonly id: string;
  /** Renumbered when the contact pool is compacted, so not exposed as stable. */
  from: number;
  to: number;
  readonly gaugeAwg: number;
  /** Recomputed whenever the route changes; see `setWireBends`. */
  lengthMm: number;
  /**
   * Insulation colour, as a hex string.
   *
   * Mutable because the operator picks it: a real bench has a drawer of
   * coloured jumpers, and colour is how a person tells two otherwise identical
   * wires apart -- which is the entire reason it is worth choosing.
   */
  colour: string;
  /**
   * Bends the operator placed by hand, in millimetres.
   *
   * Empty means the wire takes the automatic dogleg. These are a *routing*
   * detail and nothing else: the netlist unions the two ends whether there is
   * one bend or nine, because a jumper connects its contacts wherever it
   * happens to run. Mutable, like `from` and `to`.
   */
  bends: readonly BendPoint[];
}

/** Which end of a jumper a gesture is holding. */
export type WireEnd = 'from' | 'to';

export interface Bench {
  readonly terminals: readonly Terminal[];
  readonly parts: readonly PartInstance[];
  readonly wires: readonly Wire[];
  /**
   * Counts every change to the bench's contents.
   *
   * The collections above are mutated in place, so this is the only thing that
   * changes when a part turns or a jumper is re-clipped. Anything memoised from
   * a bench -- wire routing most of all -- has to key on this, or it keeps
   * drawing where things used to be.
   */
  readonly revision: number;
}

/**
 * The bench as it stood at one moment, deep enough to be put back exactly.
 *
 * Plain records rather than the live objects, because a snapshot that shares
 * the objects it was taken from would be rewritten by the very next drag and
 * would undo to wherever that drag ended up.
 *
 * Part *definitions* are kept by reference: they come from a catalogue of
 * factories and nothing in the bench ever mutates one, so copying them would
 * cost thousands of objects per history entry and record nothing.
 */
export interface BenchSnapshot {
  readonly terminals: readonly { readonly id: number; readonly x: number; readonly y: number }[];
  readonly parts: readonly {
    readonly id: string;
    readonly definition: PartDefinition;
    readonly x: number;
    readonly y: number;
    readonly rotation: Rotation;
    readonly terminals: Readonly<Record<string, number>>;
  }[];
  readonly wires: readonly {
    readonly id: string;
    readonly from: number;
    readonly to: number;
    readonly gaugeAwg: number;
    readonly lengthMm: number;
    readonly colour: string;
    readonly bends: readonly BendPoint[];
  }[];
  /**
   * The id counters, carried so a part added after an undo cannot be handed an
   * id a restored part is already using.
   */
  readonly nextPartSerial: number;
  readonly nextWireSerial: number;
}

/**
 * Accumulates a bench, handing every pin a contact and keeping it informed of
 * where that pin currently is.
 *
 * Contact lookup is a linear scan rather than a spatial index. A fully
 * populated breadboard is under a thousand terminals and a lookup touches all
 * of them, so the scan costs microseconds and saves the index from having to
 * be kept consistent as parts move.
 */
export class BenchBuilder {
  private readonly terminals: Terminal[] = [];
  private readonly parts: PartInstance[] = [];
  private readonly wires: Wire[] = [];
  private nextPartSerial = 1;
  private nextWireSerial = 1;


  /**
   * Records the bench as it is now.
   *
   * Taken before a change rather than after, so a history entry is "what the
   * bench looked like before this edit" and undoing is a matter of putting the
   * newest one back.
   */
  snapshot(): BenchSnapshot {
    return {
      terminals: this.terminals.map((terminal) => ({
        id: terminal.id,
        x: terminal.x,
        y: terminal.y,
      })),
      parts: this.parts.map((part) => ({
        id: part.id,
        definition: part.definition,
        x: part.x,
        y: part.y,
        rotation: part.rotation,
        terminals: { ...part.terminals },
      })),
      wires: this.wires.map((wire) => ({
        id: wire.id,
        from: wire.from,
        to: wire.to,
        gaugeAwg: wire.gaugeAwg,
        lengthMm: wire.lengthMm,
        colour: wire.colour,
        bends: wire.bends.map((bend) => ({ x: bend.x, y: bend.y })),
      })),
      nextPartSerial: this.nextPartSerial,
      nextWireSerial: this.nextWireSerial,
    };
  }

  /**
   * Puts a snapshot back, replacing everything.
   *
   * The arrays are emptied and refilled rather than reassigned, because
   * `build()` hands out the live arrays and every renderer is holding one.
   * Reassigning would leave them looking at a bench that is no longer this
   * builder's.
   *
   * A restore is not re-solved here: the caller owns the circuit, and it has to
   * rebuild anyway to put the solver's nets back in step with the contacts.
   */
  restore(snapshot: BenchSnapshot): void {
    this.terminals.length = 0;
    for (const terminal of snapshot.terminals) {
      this.terminals.push({ id: terminal.id, x: terminal.x, y: terminal.y });
    }

    this.parts.length = 0;
    for (const part of snapshot.parts) {
      this.parts.push({
        id: part.id,
        definition: part.definition,
        x: part.x,
        y: part.y,
        rotation: part.rotation,
        terminals: { ...part.terminals },
      });
    }

    this.wires.length = 0;
    for (const wire of snapshot.wires) {
      this.wires.push({
        id: wire.id,
        from: wire.from,
        to: wire.to,
        gaugeAwg: wire.gaugeAwg,
        lengthMm: wire.lengthMm,
        colour: wire.colour,
        bends: wire.bends.map((bend) => ({ x: bend.x, y: bend.y })),
      });
    }

    this.nextPartSerial = snapshot.nextPartSerial;
    this.nextWireSerial = snapshot.nextWireSerial;
    // A restore replaces the bench wholesale, so anything memoised from it is
    // stale whether or not the shape happens to match.
    this.markChanged();
  }

  /** Places a part with its top-left corner at (x, y). */
  addPart(definition: PartDefinition, x: number, y: number, rotation: Rotation = 0): PartInstance {
    const part: PartInstance = {
      id: `p${this.nextPartSerial++}`,
      definition,
      x,
      y,
      rotation,
      terminals: {},
    };
    this.resolveHoles(part);
    this.parts.push(part);
    this.markChanged();
    return part;
  }

  /**
   * Moves a part to a new origin, carrying its pins' contacts along with it.
   *
   * Nothing is allocated and nothing is left behind: a jumper clipped to one
   * of this part's pins travels with it, and the contact the pin used to sit
   * in is released back to whatever else shares that hole.
   */
  movePart(id: string, x: number, y: number): void {
    const part = this.parts.find((candidate) => candidate.id === id);
    if (!part) return;
    part.x = x;
    part.y = y;
    this.resolveHoles(part);
    this.markChanged();
  }

  /**
   * Turns a part a quarter turn about its own centre.
   *
   * The origin moves as well as the angle, and that is the part that is easy to
   * leave out. A quarter turn of a part that is wider than it is tall swaps its
   * bounding box over, so the centre sits half a width to the left and half a
   * height lower than it did -- and a part whose origin was left alone appears
   * to jump sideways by the difference between its own two dimensions. On a
   * breadboard that reads as the part teleporting out of its row.
   *
   * Carrying the centre across instead keeps the part exactly where it was put,
   * which is what turning something on a desk actually does.
   */
  rotatePart(id: string, rotation: Rotation): void {
    const part = this.parts.find((candidate) => candidate.id === id);
    if (!part) return;

    /*
     * Wrapped back into a single turn. The bench turns by repeated +90s with
     * no wrap of its own, so the fifth press arrives as 450: past every
     * ===90/270 check while the renderer draws it mod 360, which detaches the
     * painted leads from their holes. The stored value stays canonical, so
     * the readout, the resolver and the canvas always mean the same angle.
     */
    const wrapped = (((rotation % 360) + 360) % 360) as Rotation;

    /*
     * Measured in the box the part is in now, not the one its definition
     * declares: after a quarter turn the part occupies the swapped box, and
     * halving the unrotated width instead walks the centre 4.75 mm per turn
     * (half the width/height difference, compounding every press), dragging
     * the leads out from under their wires while the resolver insists nothing
     * moved.
     */
    const { widthMm, heightMm } = part.definition;
    const turned = part.rotation === 90 || part.rotation === 270;
    const centreX = part.x + (turned ? heightMm : widthMm) / 2;
    const centreY = part.y + (turned ? widthMm : heightMm) / 2;

    // The bounding box a quarter turn produces is the old one with its sides
    // exchanged, so the centre has to be measured in the new box.
    const swapped = wrapped === 90 || wrapped === 270;
    const drawnWidth = swapped ? heightMm : widthMm;
    const drawnHeight = swapped ? widthMm : heightMm;

    part.x = centreX - drawnWidth / 2;
    part.y = centreY - drawnHeight / 2;
    part.rotation = wrapped;
    this.resolveHoles(part);
    this.markChanged();
  }

  /**
   * Runs a jumper between two board positions, snapping each end onto
   * whatever contact is already there or claiming a fresh one if nothing is.
   *
   * Ends are the one place sharing an id is right: two jumpers in the same
   * breadboard hole are in the same contact, and moving the part whose pin
   * they are clipped to should not drag the other jumper out of the hole.
   */
  addWire(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options: { colour?: string; gaugeAwg?: number; bends?: readonly BendPoint[] } = {},
  ): Wire {
    const from = this.terminalAt(fromX, fromY);
    const to = this.terminalAt(toX, toY);
    const bends = options.bends ?? [];
    const wire: Wire = {
      id: `w${this.nextWireSerial++}`,
      from,
      to,
      gaugeAwg: options.gaugeAwg ?? 26,
      // A wire bent round corners is longer than the straight line between its
      // ends, and the solver turns this into resistance, so it has to be the
      // length actually run rather than the crow-flies distance.
      lengthMm: routedLengthMm(fromX, fromY, bends, toX, toY),
      colour: options.colour ?? '#d94f4f',
      bends: [...bends],
    };
    this.wires.push(wire);
    this.markChanged();
    return wire;
  }

  /**
   * Re-clips one end of a placed jumper to another contact.
   *
   * The gesture Wokwi calls dragging a wire, and the one that matters most once
   * a board is wired: moving an end from one pin to another is a correction,
   * whereas cutting the wire and drawing a new one loses the bends the operator
   * hand-placed and leaves a stray end on the bench.
   *
   * The contact is claimed the same way `addWire` claims one, so a wire dropped
   * on bare bench ends at a loose contact rather than snapping to whatever hole
   * happens to be nearby. Both ends being re-solved from the new terminals is the
   * whole point: the netlist unions whatever the two ends now are.
   */
  moveWireEnd(id: string, end: WireEnd, x: number, y: number): void {
    const wire = this.wires.find((candidate) => candidate.id === id);
    if (!wire) return;
    const terminal = this.terminalAt(x, y);
    if (terminal === wire.from || terminal === wire.to) return;

    const old = this.terminals[end === 'from' ? wire.from : wire.to];
    if (end === 'from') wire.from = terminal;
    else wire.to = terminal;

    /*
     * The hand-placed shape follows the drag, rubber-band style: bends are
     * absolute bench positions from the old shape, and leaving them behind
     * while the end travels re-threads the wire through stale points --
     * nodes stranded in empty space, as if the wire forgot its own route.
     * The far end stays pinned, so only the travelled delta carries across.
     */
    const fresh = this.terminals[end === 'from' ? wire.from : wire.to];
    const dx = fresh.x - old.x;
    const dy = fresh.y - old.y;
    if (dx !== 0 || dy !== 0) {
      wire.bends = wire.bends.map((bend) => ({ x: bend.x + dx, y: bend.y + dy }));
    }

    const from = this.terminals[wire.from];
    const to = this.terminals[wire.to];
    wire.lengthMm = routedLengthMm(from.x, from.y, wire.bends, to.x, to.y);
    // The contact the end left is released, so a wire dragged off a breadboard
    // hole does not leave a phantom pin behind in the netlist.
    this.pruneTerminals();
    this.markChanged();
  }

  /**
   * Recolours a placed jumper.
   *
   * A drawing operation rather than an electrical one, which is why it does not
   * re-solve: insulation colour carries no electrical meaning, so the panel
   * reporting a measured net rather than a guess from the wire stays true.
   */
  setWireColour(id: string, colour: string): void {
    const wire = this.wires.find((candidate) => candidate.id === id);
    if (!wire) return;
    wire.colour = colour;
    this.markChanged();
  }

  /**
   * Replaces a jumper's bends wholesale, re-measuring its length.
   *
   * The one way to change a placed wire's shape. Setting an empty list hands
   * it back to the automatic router, which is how a hand-routed wire is
   * released rather than deleted.
   */
  setWireBends(id: string, bends: readonly BendPoint[]): void {
    const wire = this.wires.find((candidate) => candidate.id === id);
    if (!wire) return;
    const from = this.terminals[wire.from];
    const to = this.terminals[wire.to];
    wire.bends = [...bends];
    // Length tracks the route, so it has to be re-measured on every change or
    // the solver would price a reshaped jumper at its old resistance.
    wire.lengthMm = routedLengthMm(from.x, from.y, wire.bends, to.x, to.y);
    this.markChanged();
  }

  /**
   * Drops one bend, keeping the rest in order.
   *
   * Used both for the operator removing a waypoint and for a drag that pulls
   * one off the end of the list, which is the same operation.
   */
  removeWireBend(id: string, index: number): void {
    const wire = this.wires.find((candidate) => candidate.id === id);
    if (!wire || index < 0 || index >= wire.bends.length) return;
    const bends = wire.bends.filter((_, position) => position !== index);
    this.setWireBends(id, bends);
  }

  /**
   * Inserts a bend at a position along the route rather than at its end.
   *
   * Order is what makes the wire's shape, so inserting mid-list is what puts
   * a waypoint on the leg it was clicked near instead of always tacking it on
   * the far end.
   */
  insertWireBend(id: string, index: number, bend: BendPoint): void {
    const wire = this.wires.find((candidate) => candidate.id === id);
    if (!wire) return;
    const bends = [...wire.bends];
    const at = Math.max(0, Math.min(index, bends.length));
    bends.splice(at, 0, bend);
    this.setWireBends(id, bends);
  }

  /**
   * Lifts a part off the bench, taking its wires with it.
   *
   * A jumper clipped to one of its pins keeps its own contact where the pin
   * used to be, which is what pulling a board off a jumper actually does. But a
   * wire with one end left dangling is not that: it is a wire to a hole that
   * nothing holds any more, and the netlist would still count it. Removing the
   * part therefore removes the wires it was holding.
   */
  removePart(id: string): void {
    const index = this.parts.findIndex((part) => part.id === id);
    if (index < 0) return;
    const released = new Set(Object.values(this.parts[index].terminals));
    this.parts.splice(index, 1);

    // Every wire clipped to a terminal the part owned goes with it, in one
    // pass: filtering in a loop would renumber the indices under the cursor.
    const keep = this.wires.filter(
      (wire) => !released.has(wire.from) && !released.has(wire.to),
    );
    this.wires.length = 0;
    this.wires.push(...keep);
    this.pruneTerminals();
    this.markChanged();
  }

  removeWire(id: string): void {
    const index = this.wires.findIndex((wire) => wire.id === id);
    if (index < 0) return;
    this.wires.splice(index, 1);
    this.pruneTerminals();
    this.markChanged();
  }

  terminalAtPosition(x: number, y: number): Terminal | null {
    let best: Terminal | null = null;
    let bestDistance = SNAP_DISTANCE_MM;
    for (const terminal of this.terminals) {
      const distance = Math.hypot(terminal.x - x, terminal.y - y);
      if (distance < bestDistance) {
        best = terminal;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * The bench, wrapped for the renderer, plus a count of what has changed.
   *
   * Built once and handed back every time, because the collections are mutated
   * in place rather than replaced: a part is pushed onto `parts` and the array
   * it lands in is the same one the last caller is holding. So a fresh wrapper
   * each call would be a different object describing exactly the same bench.
   *
   * That stability is why `revision` exists. Identity alone cannot report a
   * change -- a pin moving mutates a terminal rather than replacing it -- so
   * anything memoised from the bench has to key on the count. Without it, wire
   * routing keeps drawing where a part's pins used to be, which is exactly what
   * turning a panel looked like.
   */
  private built: Bench | null = null;

  private revision = 0;

  /** Records that the bench has changed in a way identity cannot show. */
  markChanged(): void {
    this.revision += 1;
    // A cached bench captured the old count, so it has to be rebuilt rather
    // than patched: the wrapper holds it as a plain value.
    this.built = null;
  }

  build(): Bench {
    this.built ??= {
      terminals: this.terminals,
      parts: this.parts,
      wires: this.wires,
      revision: this.revision,
    };
    return this.built;
  }

  /**
   * Gives each of a part's pins a contact, claiming one the first time it is
   * resolved and carrying it to the pin's new place on every call after.
   *
   * A pin never borrows a contact that is already there. Sharing is decided
   * downstream from geometry, which is what lets a resistor dropped into a
   * breadboard column join that column without either part adopting it.
   */
  private resolveHoles(part: PartInstance): void {
    for (const pin of part.definition.pins) {
      const offset = rotateOffset(
        pin.x,
        pin.y,
        part.rotation,
        part.definition.widthMm,
        part.definition.heightMm,
      );
      const held = part.terminals[pin.id];
      if (held === undefined) {
        part.terminals[pin.id] = this.claimTerminal(part.x + offset.x, part.y + offset.y);
        continue;
      }
      const terminal = this.terminals[held];
      terminal.x = part.x + offset.x;
      terminal.y = part.y + offset.y;
    }
  }

  /** Allocates a contact of its own, for a jumper end with no hole to share. */
  private claimTerminal(x: number, y: number): number {
    const id = this.terminals.length;
    this.terminals.push({ id, x, y });
    return id;
  }

  /** A jumper end shares an occupied contact, or claims a fresh one. */
  private terminalAt(x: number, y: number): number {
    const existing = this.terminalAtPosition(x, y);
    return existing ? existing.id : this.claimTerminal(x, y);
  }

  /**
   * Drops contacts that no pin and no jumper still points at.
   *
   * Ids are dense array indices all the way down into the solver, so closing a
   * gap renumbers; pins and jumpers are remapped through the same table so the
   * bench stays internally consistent.
   */
  private pruneTerminals(): void {
    const held = new Set<number>();
    for (const part of this.parts) {
      for (const id of Object.values(part.terminals)) held.add(id);
    }
    for (const wire of this.wires) {
      held.add(wire.from);
      held.add(wire.to);
    }
    if (held.size >= this.terminals.length) return;

    const remap = new Map<number, number>();
    const kept: Terminal[] = [];
    for (const terminal of this.terminals) {
      if (!held.has(terminal.id)) continue;
      remap.set(terminal.id, kept.length);
      kept.push({ id: kept.length, x: terminal.x, y: terminal.y });
    }
    this.terminals.length = 0;
    this.terminals.push(...kept);

    for (const part of this.parts) {
      for (const pin of Object.keys(part.terminals)) {
        part.terminals[pin] = remap.get(part.terminals[pin])!;
      }
    }
    for (const wire of this.wires) {
      wire.from = remap.get(wire.from)!;
      wire.to = remap.get(wire.to)!;
    }
  }
}