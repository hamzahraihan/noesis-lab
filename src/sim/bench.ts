/**
 * The physical bench: parts placed on a surface, jumper wires between them.
 *
 * A `Terminal` is a real contact point -- a breadboard hole, a header pin, a
 * wire end. Terminals are allocated once and only merged when something
 * physically connects them, which is what lets the netlist extractor stay a
 * pure union-find with no geometric guesswork.
 *
 * Positions are mutable on purpose. Dragging a part updates it in place and
 * re-resolves its holes, which is far cheaper than rebuilding the bench and
 * keeps part identity -- and therefore firmware state -- stable across a drag.
 */

import { type PartDefinition, type Rotation, rotateOffset } from './catalog';

/** How close a placed part pin must be to an existing hole to share it. */
const SNAP_DISTANCE_MM = 0.4;

export interface Terminal {
  readonly id: number;
  readonly x: number;
  readonly y: number;
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
  readonly from: number;
  readonly to: number;
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
 * Accumulates a bench, resolving snapped holes as parts are placed and moved.
 *
 * Snap resolution is a linear scan rather than a spatial index. A fully
 * populated breadboard is under a thousand terminals and a placement touches a
 * few dozen, so the scan costs microseconds and saves the index from having to
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
   * Moves a part to a new origin, re-resolving which holes its pins land in.
   *
   * Terminals the part vacates stay in the pool: they simply become isolated
   * nets, and the solver ties those to ground through gmin rather than failing.
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
   * Runs a jumper between two board positions, snapping each end to whatever
   * hole is already there or claiming a fresh terminal if nothing is.
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

  removePart(id: string): void {
    const index = this.parts.findIndex((part) => part.id === id);
    if (index >= 0) this.parts.splice(index, 1);
  }

  removeWire(id: string): void {
    const index = this.wires.findIndex((wire) => wire.id === id);
    if (index >= 0) this.wires.splice(index, 1);
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

  private resolveHoles(part: PartInstance): void {
    for (const pin of part.definition.pins) {
      const offset = rotateOffset(pin.x, pin.y, part.rotation);
      part.terminals[pin.id] = this.terminalAt(part.x + offset.x, part.y + offset.y);
    }
  }

  /** Reuses an existing hole if one is within snapping distance, else claims one. */
  private terminalAt(x: number, y: number): number {
    const existing = this.terminalAtPosition(x, y);
    if (existing) return existing.id;
    const id = this.terminals.length;
    this.terminals.push({ id, x, y });
    return id;
  }
}