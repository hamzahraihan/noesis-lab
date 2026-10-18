import { describe, expect, it } from 'vitest';
import {
  routeWire,
  routeWireCorners,
  routeWireVia,
  routeWireViaCorners,
  wireLanes,
  type Point,
  type RouteSpan,
} from './wire-route';

/**
 * Orthogonal routing.
 *
 * Two rules carry everything here, and both exist because the alternative looked
 * wrong on the bench: no run may move on both axes at once, and a wire the
 * operator has shaped by hand is drawn exactly where they put it -- no lane
 * offset, because a lane is a nudge the router invented and a hand-placed
 * waypoint is a decision.
 */
describe('automatic routing', () => {
  it('draws a straight run when the contacts already line up', () => {
    // Same y: nothing to turn at, so no corner and no lane.
    expect(routeWireCorners({ x: 0, y: 0 }, { x: 40, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
  });

  it('keeps every run on one axis', () => {
    const corners = routeWireCorners({ x: 0, y: 0 }, { x: 40, y: 25 });
    for (let i = 0; i + 1 < corners.length; i++) {
      const a = corners[i];
      const b = corners[i + 1];
      const movesOnBothAxes = a.x !== b.x && a.y !== b.y;
      expect(movesOnBothAxes).toBe(false);
    }
  });

  it('separates wires that would otherwise overlap', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 40, y: 25 };
    const plain = routeWire(from, to, 0);
    const offset = routeWire(from, to, 3);

    // Same shape family, different line: the lane moves the dogleg sideways.
    expect(offset).not.toBe(plain);
    expect(routeWireCorners(from, to, 3)).not.toEqual(routeWireCorners(from, to, 0));
  });

  it('routes towards whichever axis dominates', () => {
    const across = routeWireCorners({ x: 0, y: 0 }, { x: 90, y: 10 });
    const down = routeWireCorners({ x: 0, y: 0 }, { x: 10, y: 90 });

    // Mostly sideways means the first run goes across; mostly down means it
    // drops first. Forcing either into the other is what produced doglegs.
    expect(across[1].y).toBe(0);
    expect(down[1].x).toBe(0);
  });
});

describe('lane assignment', () => {
  /*
   * The failure these guard against is a jumper's detour growing with the size
   * of the bench rather than the size of its own bundle. Numbering lanes by the
   * wire's place in the whole array put wire nineteen nearly forty millimetres
   * past the line it belonged on, so a loaded example fanned its wires clean
   * across the board and read as a tangle. The invariant is that a wire's lane
   * depends only on the wires turning on its line, so the assertions below are
   * all about that independence.
   */

  /** The line a wire actually turns on, as drawn: its middle corner. */
  const turnsAt = (span: RouteSpan, lane: number): Point =>
    routeWireCorners(span.from, span.to, lane)[1];

  const sideways = (id: string, from: Point, to: Point): RouteSpan => ({ id, from, to });

  it('keeps every wire in a bundle on its own line', () => {
    // Four jumpers dropping into the same breadboard column from three
    // different pins: all four turn on the same x, so all four need a lane.
    const spans = [
      sideways('a', { x: 30, y: 2 }, { x: 120, y: 40 }),
      sideways('b', { x: 30, y: 5 }, { x: 120, y: 43 }),
      sideways('c', { x: 20, y: 8 }, { x: 120, y: 46 }),
      sideways('d', { x: 40, y: 11 }, { x: 120, y: 49 }),
    ];
    const lanes = wireLanes(spans);

    const turningOn = spans.map((span) => turnsAt(span, lanes.get(span.id) ?? 0).x);
    expect(new Set(turningOn).size).toBe(spans.length);
  });

  it('leaves a wire alone when unrelated wires join the bench', () => {
    const bundle = [
      sideways('a', { x: 30, y: 2 }, { x: 120, y: 40 }),
      sideways('b', { x: 30, y: 5 }, { x: 120, y: 43 }),
    ];
    const elsewhere = [
      sideways('stray-1', { x: 10, y: 90 }, { x: 90, y: 96 }),
      sideways('stray-2', { x: 10, y: 100 }, { x: 91, y: 106 }),
      sideways('stray-3', { x: 10, y: 110 }, { x: 92, y: 116 }),
    ];

    const before = wireLanes(bundle);
    const after = wireLanes([...bundle, ...elsewhere]);

    for (const span of bundle) {
      expect(after.get(span.id)).toBe(before.get(span.id));
    }
    for (const span of elsewhere) expect(after.get(span.id)).toBe(0);
  });

  it('spreads a bundle either side of the line rather than off one side', () => {
    const spans = [
      sideways('a', { x: 30, y: 2 }, { x: 120, y: 40 }),
      sideways('b', { x: 30, y: 5 }, { x: 120, y: 43 }),
      sideways('c', { x: 30, y: 8 }, { x: 120, y: 46 }),
    ];
    const lanes = wireLanes(spans);

    // Centred, so the group straddles the line: the middle wire takes it as it
    // was, and its neighbours sit one spacing either side.
    const offsets = spans.map((span) => (lanes.get(span.id) ?? 0) * 2.2);
    expect(offsets.reduce((sum, offset) => sum + offset, 0)).toBeCloseTo(0);
    expect(turnsAt(spans[1], lanes.get('b') ?? 0).x).toBe(120);
    expect(turnsAt(spans[0], lanes.get('a') ?? 0).x).toBeLessThan(120);
    expect(turnsAt(spans[2], lanes.get('c') ?? 0).x).toBeGreaterThan(120);
  });

  it('separates wires that drop into the same row', () => {
    // Mostly down, so each turns on the breadboard row instead of the column --
    // the mirror of the sideways case, and a different line to separate on.
    const spans = [
      { id: 'a', from: { x: 30, y: 2 }, to: { x: 100, y: 90 } },
      { id: 'b', from: { x: 33, y: 2 }, to: { x: 103, y: 90 } },
    ];
    const lanes = wireLanes(spans);
    const rows = spans.map((span) => turnsAt(span, lanes.get(span.id) ?? 0).y);

    expect(rows[0]).not.toBe(rows[1]);
  });

  it('does not push wires off the line for one drawn as a straight run', () => {
    // A wire whose ends already line up is drawn straight and has no lane to
    // take. Counting it would shove its neighbours off a line nothing is on.
    const straight = sideways('straight', { x: 60, y: 40 }, { x: 60, y: 90 });
    const spans = [
      sideways('a', { x: 30, y: 2 }, { x: 120, y: 40 }),
      sideways('b', { x: 30, y: 5 }, { x: 120, y: 43 }),
      straight,
    ];

    expect(wireLanes(spans).get('straight')).toBeUndefined();
    expect(wireLanes(spans).get('a')).toBe(wireLanes(spans.slice(0, 2)).get('a'));
  });

  it('holds a jumper within a lane spacing of the line its contacts put it on', () => {
    // The whole point: whatever else is on the bench, the wire stays beside the
    // line its own two contacts make rather than sailing off past them.
    const bundle = [
      sideways('a', { x: 30, y: 2 }, { x: 120, y: 40 }),
      sideways('b', { x: 30, y: 5 }, { x: 120, y: 43 }),
      sideways('c', { x: 20, y: 8 }, { x: 120, y: 46 }),
    ];
    const elsewhere = Array.from({ length: 20 }, (_, i) =>
      sideways(`stray-${i}`, { x: 10, y: 90 + i }, { x: 90 + i, y: 96 + i }),
    );

    /** How far the drawn path strays outside the box its contacts span. */
    const stray = (span: RouteSpan, lanes: ReadonlyMap<string, number>): number => {
      const corners = routeWireCorners(span.from, span.to, lanes.get(span.id) ?? 0);
      const spread = (axis: 'x' | 'y'): number =>
        Math.max(
          ...corners.map((corner) =>
            Math.max(
              Math.min(span.from[axis], span.to[axis]) - corner[axis],
              corner[axis] - Math.max(span.from[axis], span.to[axis]),
            ),
          ),
        );
      return Math.round(Math.max(spread('x'), spread('y')) * 1e6) / 1e6;
    };

    const alone = wireLanes(bundle);
    const crowded = wireLanes([...bundle, ...elsewhere]);
    for (const span of bundle) {
      expect(stray(span, crowded)).toBeLessThanOrEqual(2.2);
      expect(stray(span, crowded)).toBe(stray(span, alone));
    }
  });

  it('redraws a wire only when its own group gains one', () => {
    // End to end, through the path the bench actually draws. A jumper arriving
    // elsewhere on the bench is none of this wire's business; one joining its
    // group is, because that is the wire it would be drawn on top of.
    const existing = [sideways('a', { x: 30, y: 2 }, { x: 120, y: 40 })];
    const elsewhere = sideways('far', { x: 10, y: 90 }, { x: 90, y: 96 });
    const alongside = sideways('b', { x: 30, y: 5 }, { x: 120, y: 43 });

    const drawn = (spans: readonly RouteSpan[], id: string): string => {
      const span = spans.find((candidate) => candidate.id === id)!;
      return routeWire(span.from, span.to, wireLanes(spans).get(id) ?? 0);
    };

    const alone = drawn(existing, 'a');
    expect(drawn([...existing, elsewhere], 'a')).toBe(alone);
    expect(drawn([...existing, alongside], 'a')).not.toBe(alone);
  });

  it('separates a fan leaving one header row for different pins', () => {
    // The character LCD: eight control lines leave one header row (same y)
    // for eight different board pins (different x). Grouping by the turning
    // line alone puts each in a group of one with lane 0, so all eight lie
    // on top of each other along the header. They must share one group.
    const fan = Array.from({ length: 8 }, (_, i) =>
      sideways(`lcd-${i}`, { x: 430 + i * 2.5, y: 146.29 }, { x: 35 + i * 4, y: 2.38 }),
    );
    const lanes = wireLanes(fan);
    expect(new Set(fan.map((span) => lanes.get(span.id))).size).toBe(fan.length);
  });
});

describe('every bend lands on the wire', () => {
  /*
   * This is the invariant that makes a waypoint handle meaningful. A handle is
   * drawn at the bend's own coordinates, so if the drawn path does not pass
   * through that point the handle floats beside the wire -- which is exactly
   * what the operator sees when a bend lands on the wrong leg.
   */
  const lies = (point: Point, path: readonly Point[], tolerance = 1e-6): boolean => {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length === 0) {
        if (Math.hypot(point.x - a.x, point.y - a.y) <= tolerance) return true;
        continue;
      }
      const offset =
        Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / length;
      if (offset > tolerance) continue;
      const along =
        point.x >= Math.min(a.x, b.x) - tolerance &&
        point.x <= Math.max(a.x, b.x) + tolerance &&
        point.y >= Math.min(a.y, b.y) - tolerance &&
        point.y <= Math.max(a.y, b.y) + tolerance;
      if (along) return true;
    }
    return false;
  };

  const routes: ReadonlyArray<{ name: string; from: Point; via: Point[]; to: Point }> = [
    { name: 'an L', from: { x: 0, y: 0 }, via: [{ x: 40, y: 0 }], to: { x: 40, y: 60 } },
    {
      name: 'a Z',
      from: { x: 0, y: 0 },
      via: [
        { x: 40, y: 0 },
        { x: 40, y: 40 },
      ],
      to: { x: 90, y: 40 },
    },
    {
      name: 'a diagonal waypoint',
      from: { x: 0, y: 0 },
      via: [{ x: 33, y: 21 }],
      to: { x: 80, y: 70 },
    },
    {
      name: 'collinear waypoints',
      from: { x: 0, y: 0 },
      via: [
        { x: 20, y: 0 },
        { x: 50, y: 0 },
      ],
      to: { x: 50, y: 40 },
    },
    {
      name: 'a waypoint past the far contact',
      from: { x: 0, y: 0 },
      via: [{ x: 120, y: 40 }],
      to: { x: 40, y: 10 },
    },
  ];

  for (const route of routes) {
    it(`passes through the waypoints on ${route.name}`, () => {
      const corners = routeWireViaCorners(route.from, route.via, route.to);
      for (const bend of route.via) {
        expect(lies(bend, corners), `bend ${bend.x},${bend.y} is off the path`).toBe(true);
      }
    });
  }

  it('draws a hand-placed route without a lane offset', () => {
    // The waypoints are exact positions. A lane would nudge them, so the handle
    // the operator is holding would stop sitting on the wire.
    const via = [{ x: 30, y: 30 }];
    const corners = routeWireViaCorners({ x: 0, y: 0 }, via, { x: 60, y: 60 });

    expect(corners).toContainEqual(via[0]);
    expect(routeWireVia({ x: 0, y: 0 }, via, { x: 60, y: 60 })).toContain('M ');
  });

  it('draws the painted wire through each waypoint, not around it', () => {
    // Corner easing cuts up to 1.6 mm off a sharp turn while the waypoint dot
    // sits at the apex, so the dot reads as floating beside the wire. A bend
    // the operator placed is drawn exact; only the router's own intermediate
    // corners keep their easing.
    const path = routeWireVia({ x: 0, y: 0 }, [{ x: 40, y: 0 }], { x: 40, y: 60 });

    // The waypoint is a line-to vertex of the painted path...
    expect(path).toContain('L 40 0');
    // ...never the control point of a curve cutting past it.
    expect(path).not.toContain('Q 40 0');
  });
});
