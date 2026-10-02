import { describe, expect, it } from 'vitest';
import { roundedPath, routeWire, routeWireCorners } from './wire-route';

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
