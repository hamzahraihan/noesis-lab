import type { PartInstance } from '../sim/bench';

/**
 * Where a part's group sits on the bench canvas.
 *
 * The turn is about the definition box's own middle, which is the same pivot
 * `rotateOffset` turns pins about -- and a quarter turn then re-centres the
 * switched box back onto that middle. Without the re-centring the painted
 * artwork orbits the middle by half the width/height difference (4.75 mm for
 * a resistor), while pins, selection and hit test stay where the resolver put
 * them: wires end in empty air and the outline frames the wrong place.
 *
 * Kept beside the canvas rather than in it so the sim/renderer contract is
 * testable without a DOM: parsed back, this must map every pin onto its
 * terminal (see `part-transform.test.ts`).
 */
export function partTransform(part: PartInstance): string {
  const { widthMm, heightMm } = part.definition;
  if (part.rotation === 0) return `translate(${part.x} ${part.y})`;
  const swapped = part.rotation === 90 || part.rotation === 270;
  const dx = swapped ? (heightMm - widthMm) / 2 : 0;
  const dy = swapped ? (widthMm - heightMm) / 2 : 0;
  return (
    `translate(${part.x + dx} ${part.y + dy}) ` +
    `rotate(${part.rotation} ${widthMm / 2} ${heightMm / 2})`
  );
}
