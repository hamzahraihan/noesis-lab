/**
 * Netlist extraction: bench geometry in, solvable circuit out.
 *
 * The whole job is union-find. Anything that physically joins two terminals --
 * a jumper, a breadboard strip, a microcontroller's ground plane, two leads
 * pushed into one hole -- unions them, and the resulting sets are the nets.
 * Element emission is a second, mechanical pass over the parts once the nets
 * are numbered.
 *
 * Choosing ground matters more than it looks. The solver needs one node pinned
 * to 0 V, and picking an arbitrary net would silently shift every reading. The
 * reference is therefore always a real ground pin on a board, so a bench with
 * no ground reference is reported rather than quietly solved against the wrong
 * datum.
 */

import { GROUND, type DiodeProfile, type Element } from './elements';
import { wireResistanceOhms } from './units';
import { SNAP_DISTANCE_MM, type Bench, type PartInstance } from './bench';
import type { DynamicState } from './catalog';

export interface NetInfo {
  readonly index: number;
  readonly terminals: readonly number[];
}

export interface Netlist {
  /** Net index for each terminal; `GROUND` (-1) for the reference net. */
  readonly nodeOfTerminal: Int32Array;
  readonly nodeCount: number;
  readonly nets: readonly NetInfo[];
  readonly elements: readonly Element[];
  /** `partId:pinId` to net index. */
  readonly pinNode: ReadonlyMap<string, number>;
}

/** A tactile switch's open contact. High, but low enough to outvote gmin. */
const SWITCH_OPEN_OHMS = 1e9;
/** Closed contact resistance of a tactile switch. */
const SWITCH_CLOSED_OHMS = 0.05;
/** Keeps a potentiometer at either end from producing an infinite conductance. */
const MIN_POT_SEGMENT_OHMS = 0.1;

class DisjointSet {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }

  find(node: number): number {
    let root = node;
    while (this.parent[root] !== root) root = this.parent[root];
    // Path compression on the way back.
    let walker = node;
    while (this.parent[walker] !== root) {
      const next = this.parent[walker];
      this.parent[walker] = root;
      walker = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) {
      const swap = rootA;
      rootA = rootB;
      rootB = swap;
    }
    this.parent[rootB] = rootA;
    if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA]++;
  }
}

/**
 * Joins contacts that are sitting in the same hole.
 *
 * Two leads pushed into one breadboard column hold two contacts at one
 * coordinate, and nothing but geometry says they are joined. Bucketing on the
 * snap distance keeps this linear -- every contact only has to look at the
 * nine cells around it -- which matters because a drag re-extracts the whole
 * netlist on every pointer move.
 */
function unionCoincidentContacts(bench: Bench, sets: DisjointSet): void {
  const cells = new Map<string, number[]>();
  const snapSquared = SNAP_DISTANCE_MM * SNAP_DISTANCE_MM;

  for (const terminal of bench.terminals) {
    const cellX = Math.floor(terminal.x / SNAP_DISTANCE_MM);
    const cellY = Math.floor(terminal.y / SNAP_DISTANCE_MM);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbours = cells.get(`${cellX + dx},${cellY + dy}`);
        if (!neighbours) continue;
        for (const other of neighbours) {
          const contact = bench.terminals[other];
          const gapX = contact.x - terminal.x;
          const gapY = contact.y - terminal.y;
          if (gapX * gapX + gapY * gapY <= snapSquared) sets.union(other, terminal.id);
        }
      }
    }
    const key = `${cellX},${cellY}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(terminal.id);
    else cells.set(key, [terminal.id]);
  }
}

/**
 * Picks the reference net: the root containing any board ground pin.
 *
 * Returns `GROUND` when the bench has no ground at all, which callers surface
 * as "no reference" rather than solving against an arbitrary datum.
 */
function chooseGroundRoot(
  bench: Bench,
  sets: DisjointSet,
): number {
  for (const part of bench.parts) {
    if (part.definition.component.kind !== 'mcu') continue;
    for (const pin of part.definition.boardPins ?? []) {
      if (pin.role !== 'ground') continue;
      const terminal = part.terminals[pin.id];
      if (terminal !== undefined) return sets.find(terminal);
    }
  }
  return GROUND;
}

function elementsForPart(
  part: PartInstance,
  pinNode: ReadonlyMap<string, number>,
  state: DynamicState,
): Element[] {
  const nodeAt = (pinId: string): number => pinNode.get(`${part.id}:${pinId}`) ?? GROUND;
  const component = part.definition.component;

  switch (component.kind) {
    case 'resistor':
      return [{ kind: 'resistor', a: nodeAt('a'), b: nodeAt('b'), ohms: component.ohms }];

    case 'led':
      return [
        {
          kind: 'diode',
          a: nodeAt('anode'),
          b: nodeAt('cathode'),
          profile: component.profile as DiodeProfile,
        },
      ];

    case 'capacitor':
      return [
        {
          kind: 'capacitor',
          a: nodeAt('positive'),
          b: nodeAt('negative'),
          farads: component.farads,
        },
      ];

    case 'button': {
      const closed = state.pressedButtons.has(part.id);
      return [
        {
          kind: 'resistor',
          a: nodeAt('a'),
          b: nodeAt('b'),
          ohms: closed ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label: closed ? 'closed' : 'open',
        },
      ];
    }

    case 'potentiometer': {
      const turn = state.potPositions.get(part.id) ?? 0.5;
      const clamped = Math.min(1, Math.max(0, turn));
      const lower = Math.max(MIN_POT_SEGMENT_OHMS, component.ohms * clamped);
      const upper = Math.max(MIN_POT_SEGMENT_OHMS, component.ohms * (1 - clamped));
      return [
        { kind: 'resistor', a: nodeAt('endA'), b: nodeAt('wiper'), ohms: lower },
        { kind: 'resistor', a: nodeAt('wiper'), b: nodeAt('endB'), ohms: upper },
      ];
    }

    case 'mcu':
    case 'breadboard':
    case 'display':
      // These contribute topology only. Their pins become sources, or receive
      // bus traffic, when the engine drives them -- which depends on firmware
      // state and so cannot be frozen into a static netlist.
      return [];
  }
}

/**
 * A component whose two pins landed on the same net would stamp a resistor
 * from a node to itself. That is not a modelling nicety -- it makes the matrix
 * singular -- so it is dropped here and the caller reports it as a short.
 */
function isDegenerate(element: Element): boolean {
  return element.kind !== 'ground' && element.a === element.b;
}

export function buildNetlist(bench: Bench, state: DynamicState): Netlist {
  const sets = new DisjointSet(bench.terminals.length);

  // Internal part connections: breadboard strips and rails, MCU ground planes.
  for (const part of bench.parts) {
    const byNet = new Map<string, number[]>();
    for (const pin of part.definition.pins) {
      if (!pin.net) continue;
      const members = byNet.get(pin.net) ?? [];
      members.push(part.terminals[pin.id]);
      byNet.set(pin.net, members);
    }
    for (const members of byNet.values()) {
      for (let i = 1; i < members.length; i++) sets.union(members[0], members[i]);
    }
  }

  for (const wire of bench.wires) sets.union(wire.from, wire.to);

  // Two leads sharing a hole, with no jumper and no internal net to say so.
  unionCoincidentContacts(bench, sets);

  const groundRoot = chooseGroundRoot(bench, sets);

  // Number the nets, skipping the reference.
  const nodeIndexOfRoot = new Map<number, number>();
  const netsByRoot = new Map<number, number[]>();
  let nodeCount = 0;
  for (const terminal of bench.terminals) {
    const root = sets.find(terminal.id);
    if (root === groundRoot) continue;
    if (!nodeIndexOfRoot.has(root)) {
      nodeIndexOfRoot.set(root, nodeCount);
      netsByRoot.set(root, []);
      nodeCount++;
    }
    netsByRoot.get(root)!.push(terminal.id);
  }

  const nodeOfTerminal = new Int32Array(bench.terminals.length).fill(GROUND);
  const nets: NetInfo[] = [];
  for (const [root, terminals] of netsByRoot) {
    const index = nodeIndexOfRoot.get(root)!;
    for (const terminal of terminals) nodeOfTerminal[terminal] = index;
    nets.push({ index, terminals });
  }

  const pinNode = new Map<string, number>();
  for (const part of bench.parts) {
    for (const pinId of Object.keys(part.terminals)) {
      const terminal = part.terminals[pinId];
      pinNode.set(`${part.id}:${pinId}`, nodeOfTerminal[terminal]);
    }
  }

  const elements: Element[] = [];
  for (const part of bench.parts) {
    for (const element of elementsForPart(part, pinNode, state)) {
      if (!isDegenerate(element)) elements.push(element);
    }
  }
  for (const wire of bench.wires) {
    const a = nodeOfTerminal[wire.from];
    const b = nodeOfTerminal[wire.to];
    if (a === b) continue;
    elements.push({
      kind: 'resistor',
      a,
      b,
      ohms: wireResistanceOhms(wire.gaugeAwg, wire.lengthMm),
      label: `wire ${wire.id}`,
    });
  }

  return { nodeOfTerminal, nodeCount, nets, elements, pinNode };
}
