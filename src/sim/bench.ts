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
 * How close two contacts must be to count as sharing one hole.
 *
 * Exported because the netlist needs the same number to decide which contacts
 * are physically joined; two tolerances that drift apart would wire a bench
 * that the picker cannot see.
 */
export const SNAP_DISTANCE_MM = 0.4;

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
  readonly lengthMm: number;
  readonly colour: string;
}

export interface Bench {
  readonly terminals: readonly Terminal[];
  readonly parts: readonly PartInstance[];
  readonly wires: readonly Wire[];
}

export const EMPTY_BENCH: Bench = { terminals: [], parts: [], wires: [] };

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
  }

  rotatePart(id: string, rotation: Rotation): void {
    const part = this.parts.find((candidate) => candidate.id === id);
    if (!part) return;
    part.rotation = rotation;
    this.resolveHoles(part);
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
    options: { colour?: string; gaugeAwg?: number } = {},
  ): Wire {
    const from = this.terminalAt(fromX, fromY);
    const to = this.terminalAt(toX, toY);
    const wire: Wire = {
      id: `w${this.nextWireSerial++}`,
      from,
      to,
      gaugeAwg: options.gaugeAwg ?? 26,
      lengthMm: Math.hypot(toX - fromX, toY - fromY),
      colour: options.colour ?? '#d94f4f',
    };
    this.wires.push(wire);
    return wire;
  }

  /**
   * Lifts a part off the bench, releasing the contacts nothing else holds.
   *
   * A jumper clipped to one of its pins keeps its own contact where the pin
   * used to be, which is what pulling a board off a jumper actually does.
   */
  removePart(id: string): void {
    const index = this.parts.findIndex((part) => part.id === id);
    if (index < 0) return;
    this.parts.splice(index, 1);
    this.pruneTerminals();
  }

  removeWire(id: string): void {
    const index = this.wires.findIndex((wire) => wire.id === id);
    if (index < 0) return;
    this.wires.splice(index, 1);
    this.pruneTerminals();
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

  /** Nearest terminal to a board position, or null past the snap radius. */
  nearestTerminal(x: number, y: number): Terminal | null {
    return this.terminalAtPosition(x, y);
  }

  build(): Bench {
    return {
      terminals: this.terminals,
      parts: this.parts,
      wires: this.wires,
    };
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
      const offset = rotateOffset(pin.x, pin.y, part.rotation);
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