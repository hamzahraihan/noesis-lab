import type { PartDefinition } from '@/features/parts';

/**
 * Offset of a part's first pin inside its own footprint.
 *
 * Dropping a part means landing its leads in holes, and where the leads sit
 * inside the footprint differs per part: a resistor's are 1.6 mm down, an
 * LED's are 3 mm and a potentiometer's 4.5 mm. Dropping the origin on the
 * strip row instead is what left half the palette floating above the board.
 */
export function offsetOfFirstPin(definition: PartDefinition): [x: number, y: number] {
  let x = Infinity;
  let y = Infinity;
  for (const pin of definition.pins) {
    if (pin.x < x) x = pin.x;
    if (pin.y < y) y = pin.y;
  }
  return [x, y];
}
