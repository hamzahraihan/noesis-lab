/* ------------------------------------------------------------------ *
 * tm1637 on uno: a number the sketch counts lands on the glass.
 *
 * The display's digits are the module's own registers, so the check reads
 * them where they live and compares them with the number the sketch
 * reported: the glass and the log have to agree.
 * ------------------------------------------------------------------ */

import { SEGMENT_MAP } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function tm1637Checks(build: GalleryBuild): CheckDef[] {
  const module = build.circuit.parts?.find((part) => part.type === 'tm1637')?.id;
  return [
    {
      name: 'the display counts the seconds on its glass',
      run: (sim) => {
        const started = performance.now();
        const name = 'the display counts the seconds on its glass';
        const read = sim.tm1637;
        if (read === undefined || module === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a display module');
        }
        const display = read(module);
        if (display === undefined) {
          return verdict(name, started, 'skip', 'the bench has no display module');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        if (!display.lit) {
          return verdict(name, started, 'fail', 'the glass is not lit');
        }
        const reported = /t\+(\d+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a time');
        }
        const seconds = Number(reported[1]);
        const expected = SEGMENT_MAP[String(seconds % 10)] ?? 0;
        if ((display.digits[3] ?? 0) !== expected) {
          return verdict(
            name,
            started,
            'fail',
            `the glass shows ${display.digits[3]}, not the ${expected} of ${seconds}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
