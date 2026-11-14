/* ------------------------------------------------------------------ *
 * nokia-5110 on uno: a sine wave drawn on 84x48 pixels of glass.
 *
 * The panel keeps the picture in its own memory, so the claim is that the
 * bytes the sketch writes are the pixels the glass shows -- and that the
 * wave moves, which is what the phase is for. The signature pairs the
 * number of lit pixels in the middle band with the row the centre column
 * is lit on: a still wave has one of them, a travelling one has many.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function nokia5110Checks(build: GalleryBuild): CheckDef[] {
  const panel = build.circuit.parts?.find((part) => part.type === 'nokia-5110')?.id;
  return [
    {
      name: 'the wave the sketch writes appears on the glass and moves',
      run: (sim) => {
        const started = performance.now();
        const name = 'the wave the sketch writes appears on the glass and moves';
        const read = sim.panel;
        if (read === undefined || panel === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a panel');
        }
        let woke = false;
        let middleLit = false;
        const signatures = new Set<string>();
        for (let frame = 0; frame < 80; frame++) {
          sim.tick(0.05);
          const glass = read(panel);
          if (glass === undefined) continue;
          if (glass.lit) woke = true;
          // The middle band of the glass: the rows the wave passes through.
          let bandCount = 0;
          for (let x = 0; x < 84; x++) {
            for (let y = 16; y < 32; y++) {
              if (glass.isLit(x, y)) bandCount++;
            }
          }
          if (bandCount > 0) middleLit = true;
          // The centre column's lit row, which is where the wave is at that
          // moment. A wave that stands still has one row for ever.
          let centreRow = -1;
          for (let y = 0; y < 48; y++) {
            if (glass.isLit(42, y)) {
              centreRow = y;
              break;
            }
          }
          // Only a frame that caught the wave on the glass counts: a frame
          // that caught the panel half-cleared would otherwise add a
          // signature of its own.
          if (centreRow >= 0) signatures.add(`${bandCount}:${centreRow}`);
        }
        if (!woke) {
          return verdict(name, started, 'fail', 'the glass never came on');
        }
        if (!middleLit) {
          return verdict(name, started, 'fail', 'no pixel in the middle band was ever lit');
        }
        if (signatures.size < 2) {
          return verdict(name, started, 'fail', 'the wave never moved');
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
