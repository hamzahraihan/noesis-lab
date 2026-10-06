import type { PartInstance, Terminal } from '../sim/bench';
import { artworkBox } from './wokwi';

/**
 * Which part a press landed on.
 *
 * Asked by geometry, and the reason is worth keeping: the alternative was to
 * walk up the DOM from whatever the browser thought was under the pointer, and
 * that is the wrong answer on this bench. A jumper's hit path is drawn in a
 * layer above every part -- it has to be, or a wire would be ungrabbable where a
 * part covers it -- so a press that landed on a wire resolved to the `<svg>`
 * and no part at all.
 *
 * On a resistor the two collided completely. The body is 3.2 mm tall and the
 * hit path is 3.2 mm wide and starts at the pin, so the wire covered the part
 * from end to end. The moment a wire was attached, the part could not be picked
 * up, selected, or moved: the press became a wire drag instead.
 *
 * So this asks the question the pointer is actually asking -- which part's body
 * is here -- rather than which element happens to be painted on top.
 */

/** A point on the bench, in millimetres. */
export interface PointMm {
  readonly x: number;
  readonly y: number;
}

/** The parts to search. A whole `Bench` satisfies this. */
export interface BenchForHit {
  readonly parts: readonly PartInstance[];
}

/**
 * Which thing a click that landed on both a part and a wire picks.
 *
 * The press path already lets a part beat a wire body while dragging; clicks
 * have to agree, or pressing a wired resistor moves it while clicking the
 * same spot opens the wire's colour palette instead of the inspector. A wire
 * is still picked by clicking it where no part sits underneath.
 */
/**
 * What a click on a wire does: split the segment, open the palette, or defer
 * to the pin under the cursor.
 *
 * First click drops a waypoint where it landed (Wokwi-style segment
 * splitting) and selects the wire; clicking the already-selected wire opens
 * its colour palette instead of piling bends onto it. A part underneath wins
 * outright (`select-part`), and a click that began on an existing handle
 * keeps the palette so nodes are never duplicated by grabbing them. A press
 * inside a pin's own core defers to wiring (`pin`): hole proximity alone no
 * longer steals wire clicks on a dense board.
 */
export type WireClickAction = 'select-part' | 'split' | 'palette' | 'pin' | 'clear';

export function wireClickAction(
  partId: string | null,
  wireId: string | null,
  selectedWireId: string | null,
  onHandle: boolean,
  nearPin: boolean,
): WireClickAction {
  if (wireId !== null && onHandle) return 'palette';
  if (!nearPin) {
    if (partId !== null) return 'select-part';
    if (wireId !== null) return wireId === selectedWireId ? 'palette' : 'split';
    return 'clear';
  }
  return 'pin';
}

/**
 * The part under a point, or null.
 *
 * Breadboards are excluded. They are the surface everything else is dropped onto,
 * so "the nearest thing above it" would be whichever part happened to be closest
 * rather than the one that was aimed at, and a press on empty board has to mean
 * empty board.
 *
 * The box tested is the one the part's artwork paints, as `artworkBox`
 * reports it: centred on the definition box and sized by what is drawn, at
 * the part's own rotation. Testing anything else misses the visible body --
 * a press on it finds no part and the drag becomes a pan.
 */
export function rotatedPartAt(
  bench: BenchForHit,
  point: PointMm,
): PartInstance | null {
  let best: PartInstance | null = null;
  let bestDepth = Number.POSITIVE_INFINITY;

  for (const part of bench.parts) {
    /*
     * Every part is in play, breadboard included: it is the one part large
     * enough to mean it when pressed, and leaving it out made the board
     * itself unpickable -- no dragging, no selecting, every press falling
     * through to panning. A smaller part sitting on it still wins by being
     * the smaller box, so wiring on the board is unaffected.
     */
    const box = artworkBox(part.definition, part.rotation);
    const left = part.x + box.dx;
    const top = part.y + box.dy;

    const inside =
      point.x >= left &&
      point.x <= left + box.widthMm &&
      point.y >= top &&
      point.y <= top + box.heightMm;
    if (!inside) continue;

    /*
     * Smallest first, so a part drawn on top of a larger one is the one picked
     * up. The operator aimed at the thing they can see, not at the board it is
     * resting on.
     */
    const depth = box.widthMm * box.heightMm;
    if (depth < bestDepth) {
      best = part;
      bestDepth = depth;
    }
  }

  return best;
}

/**
 * Whether a press landed on one of the pressed part's own leads.
 *
 * A click near any hole starts a jumper, but a component dropped on the
 * breadboard is ringed by holes that are not its own: starting a wire from
 * whichever of those happened to be nearest reads as clicking the wire by
 * accident. Measured against the part's own terminals -- by position, so a
 * lead sharing its hole with the board still counts -- so a press on the
 * body selects the part while a press on a lead still wires from it.
 */
export function pressHitsOwnPin(
  part: PartInstance | null,
  terminals: readonly Terminal[],
  world: PointMm,
  radiusMm: number,
): boolean {
  if (part === null) return false;
  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  return Object.values(part.terminals).some((terminalId) => {
    const terminal = byId.get(terminalId);
    return terminal !== undefined && Math.hypot(terminal.x - world.x, terminal.y - world.y) <= radiusMm;
  });
}

/**
 * Human label for the socket under the cursor, or null when the contact
 * belongs to no part (a loose wire end).
 *
 * Boards read as `uno:AREF`: the board id plus the silkscreen label, which
 * is what the operator is looking for when hovering a header. Other parts
 * read the same way off their own definition id (`resistor-220:a`, falling
 * back to the pin id where the silkscreen is blank). Breadboard holes are
 * locations rather than pins, so they read bare (`E20`, `+12`).
 */
export function hoverPinLabel(terminalId: number, bench: BenchForHit): string | null {
  for (const part of bench.parts) {
    const pinId = Object.keys(part.terminals).find((key) => part.terminals[key] === terminalId);
    if (pinId === undefined) continue;
    const pin = part.definition.pins.find((candidate) => candidate.id === pinId);
    if (!pin) continue;
    const { definition } = part;
    if (definition.component.kind === 'breadboard') {
      const hole = breadboardHoleLabel(pin.id);
      if (hole !== null) return hole;
      continue;
    }
    const owner =
      definition.component.kind === 'mcu' ? definition.component.board.id : definition.id;
    return `${owner}:${pin.label || pin.id}`;
  }
  return null;
}

/**
 * A breadboard pin id (`s19e`, `r0_11`) in the notation printed on the
 * board: strip holes as letter-plus-column (`E20`), rails as sign-plus
 * column (`+12`). Rails 0 and 3 are the red (+) rows, 1 and 2 the blue (−).
 */
function breadboardHoleLabel(pinId: string): string | null {
  const strip = /^s(\d+)([a-j])$/.exec(pinId);
  if (strip) return `${strip[2].toUpperCase()}${Number(strip[1]) + 1}`;
  const rail = /^r([0-3])_(\d+)$/.exec(pinId);
  if (rail) return `${rail[1] === '0' || rail[1] === '3' ? '+' : '-'}${Number(rail[2]) + 1}`;
  return null;
}