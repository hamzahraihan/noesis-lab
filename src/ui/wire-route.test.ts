import { describe, expect, it } from 'vitest';
import { roundedPath, routeWire, routeWireCorners, routeWireVia, routeWireViaCorners } from './wire-route';

describe('rounded corners', () => {
  it('draws a straight run when there is nothing to turn', () => {
    expect(roundedPath([{ x: 0, y: 5 }, { x: 20, y: 5 }], 1.6)).toBe('M 0 5 L 20 5');
  });

  it('eases the corner instead of pointing at it', () => {
    const path = roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 2);
    // The corner is named as a quadratic control point, and both straight runs
    // stop short of it.
    expect(path).toBe('M 0 0 L 8 0 Q 10 0 10 2 L 10 10');
  });

  it('never turns further out than the leg it is on', () => {
    // A 1 mm leg cannot take a 5 mm bend without doubling back on itself.
    const path = roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1 }], 5);
    expect(path).toBe('M 0 0 L 9.5 0 Q 10 0 10 0.5 L 10 1');
  });

  it('drops a point that only repeats the direction it is already going', () => {
    const path = roundedPath([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 1.6);
    // The mid-run point at (5, 0) is not a turn, so no bend appears there.
    expect(path).toBe('M 0 0 L 8.4 0 Q 10 0 10 1.6 L 10 10');
  });
});

describe('routing a jumper', () => {
  const from = { x: 26.67, y: 30.48 };
  const to = { x: 285.88, y: 40.64 };

  it('runs straight when the two contacts line up', () => {
    expect(routeWire({ x: 0, y: 0 }, { x: 30, y: 0 }, 0)).toBe('M 0 0 L 30 0');
    expect(routeWire({ x: 0, y: 0 }, { x: 0, y: 30 }, 0)).toBe('M 0 0 L 0 30');
  });

  it('only ever changes direction on one axis at a time', () => {
    const corners = routeWireCorners({ x: 5, y: 10 }, { x: 60, y: 45 }, 0);
    for (let i = 1; i < corners.length; i++) {
      const dx = corners[i].x - corners[i - 1].x;
      const dy = corners[i].y - corners[i - 1].y;
      // Two wires crossing on the bench must not be able to take a diagonal
      // shortcut past each other, so no run may move on both axes.
      expect(dx === 0 || dy === 0, `run ${i} moved on both axes`).toBe(true);
    }
  });

  it('starts and ends exactly on the contacts it joins', () => {
    const corners = routeWireCorners(from, to, 3);
    expect(corners[0]).toEqual(from);
    expect(corners[corners.length - 1]).toEqual(to);
  });

  it('keeps parallel wires off each other', () => {
    const lanes = [0, 1, 2, 3].map((lane) => routeWire(from, to, lane));
    // Each lane takes a different path, or a bundle of jumpers reads as one.
    expect(new Set(lanes).size).toBe(4);
  });

  it('runs across the board when it mostly travels sideways', () => {
    // Far wider than it is tall: the long run is the horizontal one, so the
    // wire does not climb the whole board to gain four millimetres.
    const corners = routeWireCorners({ x: 0, y: 0 }, { x: 100, y: 4 }, 0);
    const across = Math.abs(corners[1].x - corners[0].x);
    const down = Math.abs(corners[2].y - corners[1].y);
    expect(across).toBeCloseTo(100, 6);
    expect(across).toBeGreaterThan(down * 10);
  });
});

describe('routing through hand-placed bends', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 50 };

  it('runs straight when there are no bends', () => {
    // No waypoints must stay byte-identical to the automatic route, or every
    // existing wire would redraw itself the moment the model gained the field.
    expect(routeWireVia(from, [], to)).toBe(routeWire(from, to, 0));
  });

  it('visits every bend in the order it was placed', () => {
    const bends = [
      { x: 20, y: 0 },
      { x: 20, y: 30 },
    ];
    const corners = routeWireViaCorners(from, bends, to);
    // Each bend is a real corner of the path, not something the router smoothed
    // away -- otherwise the wire would ignore where it was told to go.
    for (const bend of bends) {
      expect(corners).toContainEqual(bend);
    }
    // And the ordering holds, so the wire does not visit them out of sequence.
    const xs = corners.map((point) => point.x);
    expect(xs.indexOf(20)).toBeLessThan(xs.lastIndexOf(20));
  });

  it('starts and ends exactly on the contacts it joins', () => {
    const corners = routeWireViaCorners(from, [{ x: 40, y: 10 }], to);
    expect(corners[0]).toEqual(from);
    expect(corners[corners.length - 1]).toEqual(to);
  });

  it('keeps every run orthogonal even with bends', () => {
    const corners = routeWireViaCorners(from, [{ x: 40, y: 10 }, { x: 40, y: 40 }], to);
    for (let i = 1; i < corners.length; i++) {
      const dx = corners[i].x - corners[i - 1].x;
      const dy = corners[i].y - corners[i - 1].y;
      // The same rule the automatic router holds to. A bend that let a leg cut
      // diagonally would produce the scratchy wire this tool exists to avoid.
      expect(dx === 0 || dy === 0, `run ${i} moved on both axes`).toBe(true);
    }
  });

  it('passes a bend through rather than offsetting it onto a lane', () => {
    // A lane offset would drag the wire off the exact point the operator
    // clicked, so a hand-placed route must ignore lanes entirely.
    const corners = routeWireViaCorners(from, [{ x: 33, y: 0 }], to);
    expect(corners).toContainEqual({ x: 33, y: 0 });
  });

  it('drops a bend that repeats the point before it', () => {
    const corners = routeWireViaCorners(from, [{ x: 0, y: 0 }], to);
    expect(corners).toEqual(routeWireViaCorners(from, [], to));
  });

  it('rounds the turns it does draw', () => {
    // A genuine Z: across, down, across. The two bends are real corners and
    // both must be eased rather than pointed at.
    const path = routeWireVia({ x: 0, y: 0 }, [{ x: 20, y: 0 }, { x: 20, y: 20 }], { x: 40, y: 20 }, 1.6);
    expect(path).toBe('M 0 0 L 18.4 0 Q 20 0 20 1.6 L 20 18.4 Q 20 20 21.6 20 L 40 20');
  });

  it('drops a bend that only continues the run it is already on', () => {
    // Three points in a line describe one straight wire, not two corners, so
    // the middle ones must not survive as spurious bends.
    const corners = routeWireViaCorners({ x: 0, y: 0 }, [{ x: 20, y: 0 }, { x: 20, y: 40 }], { x: 20, y: 40 });
    expect(routeWireVia({ x: 0, y: 0 }, [{ x: 20, y: 0 }, { x: 20, y: 40 }], { x: 20, y: 40 }, 1.6)).toBe(
      'M 0 0 L 18.4 0 Q 20 0 20 1.6 L 20 40',
    );
    expect(corners).toContainEqual({ x: 20, y: 0 });
  });
});
