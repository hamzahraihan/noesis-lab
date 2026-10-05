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
 * twenty. The width of the spread is set by how many wires actually run
 * alongside each other -- see `wireLanes`.
 */
const LANE_SPACING_MM = 2.2;

/** A jumper as the router sees it: an id, and the two contacts it spans. */
export interface RouteSpan {
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
}

/**
 * The line a wire turns on, and so the group of wires it has to be kept clear
 * of. A wire that runs mostly sideways turns on a vertical line and one that
 * runs mostly down turns on a horizontal one, so where that line falls is the
 * only thing that decides whether two of them come out on top of each other.
 */
function crossingLine(from: Point, to: Point): string {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? `x:${to.x}` : `y:${to.y}`;
}

/**
 * The lane each automatic jumper should take, keyed by wire id.
 *
 * A lane only means anything against the wires a jumper runs alongside, so
 * that is what the grouping is by: wires turning on the same line. Numbering
 * the bench instead made a jumper's detour grow with every wire already on it
 * -- wire nineteen sat forty millimetres off the line it belonged on, and
 * adding a twentieth shoved all of them further out. A loaded example splayed
 * its fans clean past their own contacts, which is what read as tangled. The
 * detour now scales with the size of the group and nothing else.
 *
 * Each group is numbered from the middle outwards so it straddles the line it
 * was crossing anyway. Numbering from the line pushes every wire the same way
 * and fans the group off to one side, which is the same mess seen from
 * further out.
 */
export function wireLanes(spans: readonly RouteSpan[]): ReadonlyMap<string, number> {
  const groups = new Map<string, string[]>();
  for (const span of spans) {
    // A wire whose ends already line up is drawn on a straight run, which has
    // no lane to take. It neither needs one nor may claim one, or it would
    // push its neighbours off a line it is not drawn over.
    if (span.from.x === span.to.x || span.from.y === span.to.y) continue;
    const line = crossingLine(span.from, span.to);
    const group = groups.get(line);
    if (group) group.push(span.id);
    else groups.set(line, [span.id]);
  }

  const lanes = new Map<string, number>();
  for (const group of groups.values()) {
    const middle = (group.length - 1) / 2;
    group.forEach((id, rank) => lanes.set(id, rank - middle));
  }
  return lanes;
}

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
 * `lane` separates wires that would otherwise overlap; it is the wire's rank
 * within the group of wires it turns alongside, as assigned by `wireLanes`.
 * `radius` is in millimetres and exists so a preview at a different zoom keeps
 * the same shape as the wire on the bench.
 */
export function routeWire(
  from: Point,
  to: Point,
  lane = 0,
  radius = CORNER_MM,
): string {
  return roundedPath(routeWireCorners(from, to, lane), radius);
}

/**
 * One straight leg, split into orthogonal runs when its ends do not line up.
 *
 * The automatic router and the operator's own bends are held to the same rule:
 * no run ever moves on both axes at once. A jumper that takes a diagonal cut
 * across the bench looks like a scratch, and two of them crossing cannot pass
 * each other cleanly.
 */
function legCorners(from: Point, to: Point): readonly Point[] {
  if (from.x === to.x || from.y === to.y) return [from, to];
  const across = Math.abs(to.x - from.x);
  const down = Math.abs(to.y - from.y);
  return across >= down
    ? [from, { x: to.x, y: from.y }, to]
    : [from, { x: from.x, y: to.y }, to];
}

/**
 * The corners of a jumper routed through bends the operator placed by hand.
 *
 * Deliberately takes no lane. A lane offset exists to stop two automatic
 * routes resolving to the same line, and applying one here would pull the
 * wire off the very point the operator clicked to move it somewhere else --
 * the control would fight the hand. Once someone has said where the wire
 * should go, that answer is the whole routing decision.
 */
export function routeWireViaCorners(
  from: Point,
  via: readonly Point[],
  to: Point,
): readonly Point[] {
  const corners: Point[] = [from];
  let previous = from;

  for (const bend of via) {
    if (bend.x === previous.x && bend.y === previous.y) continue;
    for (const point of legCorners(previous, bend).slice(1)) corners.push(point);
    previous = bend;
  }
  for (const point of legCorners(previous, to).slice(1)) corners.push(point);

  return corners;
}

/** Routes a jumper along bends the operator placed, and rounds the turns. */
export function routeWireVia(
  from: Point,
  via: readonly Point[],
  to: Point,
  radius = CORNER_MM,
): string {
  return roundedPath(routeWireViaCorners(from, via, to), radius);
}
