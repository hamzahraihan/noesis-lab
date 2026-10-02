/**
 * Orthogonal jumper routing.
 *
 * A bench reads as a bench because the wires on it run in straight lines and
 * turn at right angles, not because they are straight. A diagonal jumper from a
 * header pin to a breadboard hole looks like a scratch on the screen; the same
 * jumper routed across and down, with the corner eased off, looks like wire.
 *
 * So every jumper here is a polyline of horizontal and vertical runs with a
 * rounded corner at each turn. The routing itself is deliberately simple --
 * one dogleg, on whichever axis the wire mostly travels -- because a bench has
 * tens of jumpers on it and a full obstacle-avoiding router produces a mess at
 * that density. What makes it readable is the lane offset: parallel wires are
 * pushed onto separate lanes so they do not lie on top of each other.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Corner radius, in millimetres. Matches the bend on a real Dupont housing. */
const CORNER_MM = 1.6;

/**
 * How far apart parallel wires are pushed, in millimetres.
 *
 * Without this every wire between the same two headers would resolve to the
 * same dogleg and the bench would look like a handful of wires rather than
 * twenty.
 */
const LANE_SPACING_MM = 2.2;

/** Corner radius of an SVG path, given in the path's own units. */
export function roundedPath(points: readonly Point[], radius: number): string {
  const corners = dropCollinear(points);
  if (corners.length === 0) return '';
  if (corners.length === 1) return `M ${corners[0].x} ${corners[0].y}`;

  let d = `M ${corners[0].x} ${corners[0].y}`;
  for (let i = 1; i < corners.length - 1; i++) {
    const previous = corners[i - 1];
    const corner = corners[i];
    const next = corners[i + 1];

    // Ease off the corner by at most half of each leg, so a short leg gets a
    // proportionally smaller bend rather than a kink.
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);

    const entry = towards(corner, previous, r);
    const exit = towards(corner, next, r);
    d += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
  }

  const last = corners[corners.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** Drops duplicate and mid-run points, which would round a straight run. */
function dropCollinear(points: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    kept.push(point);
  }
  for (let i = kept.length - 2; i > 0; i--) {
    const before = kept[i - 1];
    const here = kept[i];
    const after = kept[i + 1];
    const turnsX = here.x === before.x && here.x === after.x;
    const turnsY = here.y === before.y && here.y === after.y;
    if (turnsX || turnsY) kept.splice(i, 1);
  }
  return kept;
}

/** The point `distance` back along the leg from `corner` towards `target`. */
function towards(corner: Point, target: Point, distance: number): Point {
  const length = Math.hypot(corner.x - target.x, corner.y - target.y);
  if (length === 0) return corner;
  const scale = distance / length;
  return { x: corner.x + (target.x - corner.x) * scale, y: corner.y + (target.y - corner.y) * scale };
}

/**
 * The corners a jumper turns at, in order, before any of it is drawn.
 *
 * Kept separate from the drawing because the shape is the part with the rules
 * in it: which axis a wire runs down, and where its lane sits. Rounding the
 * corners afterwards cannot change either.
 */
export function routeWireCorners(
  from: Point,
  to: Point,
  lane = 0,
): readonly Point[] {
  // Already aligned: a straight run needs no corner and no lane.
  if (from.y === to.y || from.x === to.x) return [from, to];

  const offset = lane * LANE_SPACING_MM;
  const across = Math.abs(to.x - from.x);
  const down = Math.abs(to.y - from.y);

  // Travel along whichever axis dominates. A header pin to a breadboard hole
  // mostly runs sideways; two breadboard columns mostly run vertically, and
  // forcing either into the other shape is what produces the long doglegs.
  return across >= down
    ? [from, { x: to.x + offset, y: from.y }, { x: to.x + offset, y: to.y }, to]
    : [from, { x: from.x, y: to.y + offset }, { x: to.x, y: to.y + offset }, to];
}

/**
 * Routes a jumper between two contacts.
 *
 * `lane` separates wires that would otherwise overlap; pass a stable index for
 * the wire so its lane does not jump about as the bench changes. `radius` is
 * in millimetres and exists so a preview at a different zoom keeps the same
 * shape as the wire on the bench.
 */
export function routeWire(
  from: Point,
  to: Point,
  lane = 0,
  radius = CORNER_MM,
): string {
  return roundedPath(routeWireCorners(from, to, lane), radius);
}
