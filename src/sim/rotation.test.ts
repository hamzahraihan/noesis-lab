import { describe, expect, it } from 'vitest';
import { rotateOffset, type Rotation } from '@/features/parts';
import { BenchBuilder } from '@/features/simulation';
import { resistorDefinition } from '@/features/parts';

/**
 * Turning a part over.
 *
 * This is geometry with nothing to apologise for, so the assertions are exact:
 * a pin at a known place has to land at a known place. "Roughly right" here is
 * a resistor whose leads are in the wrong breadboard holes, which reads as a
 * dead circuit rather than as a rotation that was slightly off.
 */

/** A builder holding one resistor, which is longer than it is wide. */
function bench(): BenchBuilder {
  const builder = new BenchBuilder();
  builder.addPart(resistorDefinition(220), 100, 60);
  return builder;
}

/** Where a pin of the placed part sits, in millimetres. */
function pin(builder: BenchBuilder, pinId: string): { x: number; y: number } {
  const part = builder.build().parts[0];
  return builder.build().terminals[part.terminals[pinId]];
}

const WIDTH = 10;
const HEIGHT = 4;

describe('rotating a pin about its part', () => {
  it('leaves an unrotated pin alone', () => {
    expect(rotateOffset(2, 3, 0, WIDTH, HEIGHT)).toEqual({ x: 2, y: 3 });
  });

  it('swaps the axes on a quarter turn', () => {
    // A 10x4 part turned a quarter turn is a 4x10 part, so a pin's coordinates
    // are measured in the new box: six across becomes six down.
    expect(rotateOffset(6, 2, 90, WIDTH, HEIGHT)).toEqual({ x: 2, y: 6 });
    expect(rotateOffset(2, 3, 90, WIDTH, HEIGHT)).toEqual({ x: 1, y: 2 });
  });
  it('never puts a pin outside the part it belongs to', () => {
    // A pin off the edge is a pin in somebody else's breadboard hole, which is
    // how a turned part ends up claiming contacts it does not have.
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const spanX = rotation === 90 || rotation === 270 ? HEIGHT : WIDTH;
      const spanY = rotation === 90 || rotation === 270 ? WIDTH : HEIGHT;
      for (const [x, y] of [
        [0, 0],
        [WIDTH, 0],
        [0, HEIGHT],
        [WIDTH, HEIGHT],
        [WIDTH / 2, HEIGHT / 2],
      ]) {
        const offset = rotateOffset(x, y, rotation, WIDTH, HEIGHT);
        expect(offset.x, `${rotation}° x of (${x},${y})`).toBeGreaterThanOrEqual(0);
        expect(offset.x).toBeLessThanOrEqual(spanX);
        expect(offset.y, `${rotation}° y of (${x},${y})`).toBeGreaterThanOrEqual(0);
        expect(offset.y).toBeLessThanOrEqual(spanY);
      }
    }
  });

  it('adds two quarter turns up to a half turn', () => {
    // Each turn measures the box it is turning, so composing them has to land
    // where a single half turn does. Getting this wrong is a part that is 45
    // degrees out after two presses and nobody can say why.
    const there = rotateOffset(2, 3, 90, WIDTH, HEIGHT);
    const back = rotateOffset(there.x, there.y, 90, HEIGHT, WIDTH);
    expect(back).toEqual(rotateOffset(2, 3, 180, WIDTH, HEIGHT));
  });
});

describe('turning a part on the bench', () => {
  it('turns a resistor on its side, leads included', () => {
    const builder = bench();
    const id = builder.build().parts[0].id;

    builder.rotatePart(id, 90);

    const after = pin(builder, 'a');
    const farLead = pin(builder, 'b');
    // A resistor lies along the row, so a quarter turn stands it on end: the
    // two leads end up in the same column, `heightMm` apart instead of
    // `widthMm`. A rotation that merely exchanged the pins would leave it flat,
    // which is the failure that looks like the button doing nothing at all.
    expect(farLead.x, 'both leads share a column once it is on its end').toBe(after.x);
    expect(
      Math.abs(farLead.y - after.y),
      'and the leads are now as far apart as the part was long',
    ).toBeCloseTo(
      builder.build().parts[0].definition.pins[1].x - builder.build().parts[0].definition.pins[0].x,
      6,
    );
  });

  it('keeps the part in the same place rather than letting it jump', () => {
    const builder = bench();
    const id = builder.build().parts[0].id;
    const { widthMm, heightMm } = builder.build().parts[0].definition;
    const centreBefore = {
      x: builder.build().parts[0].x + widthMm / 2,
      y: builder.build().parts[0].y + heightMm / 2,
    };

    builder.rotatePart(id, 90);

    const part = builder.build().parts[0];
    // Turned a quarter turn, the box is the other way round: high by wide.
    expect(part.x + heightMm / 2, 'centre x').toBeCloseTo(centreBefore.x, 6);
    expect(part.y + widthMm / 2, 'centre y').toBeCloseTo(centreBefore.y, 6);
  });

  it('records the orientation it was given', () => {
    const builder = bench();
    const id = builder.build().parts[0].id;
    for (const rotation of [90, 180, 270, 0] as Rotation[]) {
      builder.rotatePart(id, rotation);
      expect(builder.build().parts[0].rotation, `${rotation}°`).toBe(rotation);
    }
  });

  it('comes back to where it started after four turns', () => {
    const builder = bench();
    const id = builder.build().parts[0].id;
    const before = pin(builder, 'a');

    for (let turn = 0; turn < 4; turn++) builder.rotatePart(id, 90);

    expect(pin(builder, 'a'), 'a full circle changes nothing').toEqual(before);
  });

  it('ignores a part that is not there', () => {
    const builder = bench();
    expect(() => builder.rotatePart('nope', 90)).not.toThrow();
    expect(builder.build().parts).toHaveLength(1);
    expect(builder.build().parts[0].rotation).toBe(0);
  });

  it('wraps past a full turn instead of accumulating degrees', () => {
    // The UI turns by repeated +90s with no wrap of its own, so the fifth
    // press arrives as 450: past every ===90/270 check while the renderer
    // draws it mod 360, which detaches the painted leads from their holes.
    const builder = bench();
    const id = builder.build().parts[0].id;
    const before = { ...pin(builder, 'a') };

    builder.rotatePart(id, 360 as Rotation);

    expect(builder.build().parts[0].rotation).toBe(0);
    expect({ ...pin(builder, 'a') }).toEqual(before);
  });

  it('treats the fifth quarter turn like the first', () => {
    const single = bench();
    const singleId = single.build().parts[0].id;
    single.rotatePart(singleId, 90);
    const singlePin = { ...pin(single, 'a') };

    const spun = bench();
    const spunId = spun.build().parts[0].id;
    const seen: number[] = [];
    for (const degrees of [90, 180, 270, 360, 450]) {
      spun.rotatePart(spunId, degrees as Rotation);
      seen.push(spun.build().parts[0].rotation);
    }

    expect(seen).toEqual([90, 180, 270, 0, 90]);
    expect({ ...pin(spun, 'a') }).toEqual(singlePin);
  });

  it('holds the centre still across consecutive turns', () => {
    // The second press onward used to measure the middle in the unrotated
    // box while the part occupied the swapped one, walking the part half the
    // width/height difference per turn and dragging its leads out from under
    // their wires.
    const builder = bench();
    const id = builder.build().parts[0].id;
    const { widthMm, heightMm } = builder.build().parts[0].definition;
    const middle = { x: 100 + widthMm / 2, y: 60 + heightMm / 2 };

    for (const degrees of [90, 180, 270, 360, 450, 540]) {
      builder.rotatePart(id, degrees as Rotation);
      const part = builder.build().parts[0];
      const turned = part.rotation === 90 || part.rotation === 270;
      const cx = part.x + (turned ? heightMm : widthMm) / 2;
      const cy = part.y + (turned ? widthMm : heightMm) / 2;
      expect(cx, `centre x after turning to ${degrees}`).toBeCloseTo(middle.x, 9);
      expect(cy, `centre y after turning to ${degrees}`).toBeCloseTo(middle.y, 9);
    }
  });
});
