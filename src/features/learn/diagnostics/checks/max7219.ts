/* ------------------------------------------------------------------ *
 * max7219 on uno: a heart is written register by register, and the glass
 * shows what the registers hold.
 *
 * The beat alternates a wide frame and a narrow one, so the left and right
 * columns have to be lit at some point and dark at another -- which is the
 * whole claim: the frame the sketch writes is the frame the glass shows.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function max7219Checks(build: GalleryBuild): CheckDef[] {
  const matrix = build.circuit.parts?.find((part) => part.type === 'max7219-matrix')?.id;
  return [
    {
      name: 'the heart the sketch writes appears on the glass',
      run: (sim) => {
        const started = performance.now();
        const name = 'the heart the sketch writes appears on the glass';
        const read = sim.matrix;
        if (read === undefined || matrix === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a matrix');
        }
        let woke = false;
        let middleLit = false;
        let edgeLit = false;
        let edgeDark = false;
        for (let frame = 0; frame < 80; frame++) {
          sim.tick(0.05);
          const glass = read(matrix);
          if (glass === undefined) continue;
          if (glass.lit) woke = true;
          // Column 3 is the heart's middle: lit from the top row down.
          if (glass.isLit(2, 1)) middleLit = true;
          if (glass.isLit(0, 1)) edgeLit = true;
          else edgeDark = true;
        }
        if (!woke) {
          return verdict(name, started, 'fail', 'the chip was never taken out of shutdown');
        }
        if (!middleLit) {
          return verdict(name, started, 'fail', 'no column was ever written');
        }
        if (!edgeLit || !edgeDark) {
          return verdict(name, started, 'fail', 'the frame never changed: the beat never showed');
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
