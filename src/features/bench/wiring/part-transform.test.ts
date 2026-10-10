import { describe, expect, it } from 'vitest';
import { BenchBuilder } from '@/features/simulation';
import type { PartDefinition, Rotation } from '@/features/parts';
import { resistorDefinition, buttonDefinition, ledDefinition } from '@/features/parts';
import { DIODE_PROFILES } from '@/features/parts';
import { partTransform } from './part-transform';
import { artworkBox } from '../wokwi';

/**
 * The canvas and the pin resolver agree about rotated parts.
 *
 * Terminals live where `rotateOffset`/`rotatePart` put them while leads paint
 * where the group's SVG transform puts them. The two agreed only at rotation
 * 0: a quarter turn orbited the artwork 4.75 mm off for a resistor, so wires
 * ended in empty air, the selection framed the wrong place, and presses on
 * the body found no part. These pin the contract from both ends -- the exact
 * transform string the canvas ships, and the geometry it must satisfy.
 */

/** A group transform, parsed without reimplementing it. */
function parseTransform(shape: string): {
  tx: number;
  ty: number;
  deg: number;
  cx: number;
  cy: number;
} {
  const turned = /translate\((\S+) (\S+)\) rotate\((\S+) (\S+) (\S+)\)/.exec(shape);
  if (turned) {
    const [, tx, ty, deg, cx, cy] = turned.map(Number);
    return { tx, ty, deg, cx, cy };
  }
  const plain = /translate\((\S+) (\S+)\)/.exec(shape);
  if (plain) {
    const [, tx, ty] = plain.map(Number);
    return { tx, ty, deg: 0, cx: 0, cy: 0 };
  }
  throw new Error(`unexpected transform: ${shape}`);
}

/** SVG rotation about (cx, cy); clockwise positive, y axis down. */
function svgRotate(
  point: { x: number; y: number },
  deg: Rotation,
  cx: number,
  cy: number,
): { x: number; y: number } {
  const radians = (deg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: cx + (point.x - cx) * cos - (point.y - cy) * sin,
    y: cy + (point.x - cx) * sin + (point.y - cy) * cos,
  };
}

const RESISTOR_AT = { x: 100, y: 60 };

function rotatedBench(make: () => PartDefinition, rotation: Rotation) {
  const builder = new BenchBuilder();
  const part = builder.addPart(make(), RESISTOR_AT.x, RESISTOR_AT.y);
  const definition = part.definition;
  const centreBefore = {
    x: RESISTOR_AT.x + definition.widthMm / 2,
    y: RESISTOR_AT.y + definition.heightMm / 2,
  };
  builder.rotatePart(part.id, rotation);
  const built = builder.build();
  const placed = built.parts.find((candidate) => candidate.id === part.id)!;
  const terminalOf = (pinId: string) => {
    const terminal = built.terminals[placed.terminals[pinId]];
    return { x: terminal.x, y: terminal.y };
  };
  return { builder, placed, definition, centreBefore, terminalOf };
}

describe('partTransform', () => {
  it('leaves an unrotated part where it was put', () => {
    const { placed } = rotatedBench(() => resistorDefinition(220), 0);
    expect(partTransform(placed)).toBe(`translate(${RESISTOR_AT.x} ${RESISTOR_AT.y})`);
  });

  it('turns about the definition middle with the switched box re-centred', () => {
    const { placed, definition } = rotatedBench(() => resistorDefinition(220), 90);
    const { tx, ty, deg, cx, cy } = parseTransform(partTransform(placed));
    expect(deg).toBe(90);
    expect([cx, cy]).toEqual([definition.widthMm / 2, definition.heightMm / 2]);
    // Re-centred, not merely moved: the translate lands back on the origin
    // the part had before the turn, so nothing jumps.
    expect(tx).toBeCloseTo(RESISTOR_AT.x, 9);
    expect(ty).toBeCloseTo(RESISTOR_AT.y, 9);
  });
});

describe('painted pins land on their terminals', () => {
  const makers: ReadonlyArray<readonly [string, () => PartDefinition]> = [
    ['resistor', () => resistorDefinition(220)],
    ['button', () => buttonDefinition()],
    ['led', () => ledDefinition(DIODE_PROFILES.green, 'Green')],
  ];

  for (const [name, make] of makers) {
    for (const rotation of [0, 90, 180, 270] as const) {
      it(`paints the ${name} leads onto their holes at ${rotation}°`, () => {
        const { placed, definition, terminalOf } = rotatedBench(make, rotation);
        const { tx, ty, deg, cx, cy } = parseTransform(partTransform(placed));
        expect(deg).toBe(rotation);

        for (const pin of definition.pins) {
          const painted = svgRotate(pin, rotation, cx, cy);
          const terminal = terminalOf(pin.id);
          expect(
            Math.hypot(painted.x + tx - terminal.x, painted.y + ty - terminal.y),
            `${name} pin ${pin.id} at ${rotation}°`,
          ).toBeLessThan(1e-9);
        }
      });
    }
  }
});

describe('the artwork stays centred through a turn', () => {
  it('keeps the painted middle where the part was put', () => {
    const { placed, definition, centreBefore } = rotatedBench(() => resistorDefinition(220), 90);
    const { tx, ty, cx, cy } = parseTransform(partTransform(placed));
    const art = artworkBox(definition, 0);
    const corners = [
      { x: art.dx, y: art.dy },
      { x: art.dx + art.widthMm, y: art.dy },
      { x: art.dx, y: art.dy + art.heightMm },
      { x: art.dx + art.widthMm, y: art.dy + art.heightMm },
    ].map((corner) => svgRotate(corner, placed.rotation, cx, cy));

    const painted = {
      x: Math.min(...corners.map((corner) => corner.x)) + tx,
      y: Math.min(...corners.map((corner) => corner.y)) + ty,
      width: Math.max(...corners.map((corner) => corner.x)) - Math.min(...corners.map((corner) => corner.x)),
      height: Math.max(...corners.map((corner) => corner.y)) - Math.min(...corners.map((corner) => corner.y)),
    };
    // The hit box is that painted box, and neither of them moved.
    const box = artworkBox(definition, placed.rotation);
    const actual = [box.dx + placed.x, box.dy + placed.y, box.widthMm, box.heightMm];
    const expected = [painted.x, painted.y, painted.width, painted.height];
    for (const [index, value] of actual.entries()) {
      expect(value, `box component ${index}`).toBeCloseTo(expected[index], 9);
    }
    expect(painted.x + painted.width / 2).toBeCloseTo(centreBefore.x, 9);
    expect(painted.y + painted.height / 2).toBeCloseTo(centreBefore.y, 9);
  });
});
