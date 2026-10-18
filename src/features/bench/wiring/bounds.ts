/**
 * Where the circuit sits, in bench millimetres.
 *
 * The canvas draws the bench through a view box, so framing a circuit when it
 * loads means knowing its extent. Three things can reach outside a part's own
 * box and all three count: the part bodies (their boxes turn with them), the
 * terminals (a header pin stands off the body), and the operator's wire bends
 * (a jumper routed around the board).
 */

import type { Bench } from '@/features/simulation';

export interface BenchBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The bench's extent, or null when there is nothing on it to frame. */
export function benchBounds(bench: Bench): BenchBounds | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const include = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x0 < left) left = x0;
    if (y0 < top) top = y0;
    if (x1 > right) right = x1;
    if (y1 > bottom) bottom = y1;
  };

  for (const part of bench.parts) {
    /*
     * A quarter turn reads the body's own width as height. `partTransform`
     * re-centres the turned box on the same middle, so the extent is simply
     * the swapped one -- the same rule the hit test and the outline use.
     */
    const swapped = part.rotation === 90 || part.rotation === 270;
    const width = swapped ? part.definition.heightMm : part.definition.widthMm;
    const height = swapped ? part.definition.widthMm : part.definition.heightMm;
    include(part.x, part.y, part.x + width, part.y + height);
  }
  for (const terminal of bench.terminals) include(terminal.x, terminal.y, terminal.x, terminal.y);
  for (const wire of bench.wires) {
    for (const bend of wire.bends) include(bend.x, bend.y, bend.x, bend.y);
  }

  if (!Number.isFinite(left)) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
