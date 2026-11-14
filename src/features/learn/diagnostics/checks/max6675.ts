/* ------------------------------------------------------------------ *
 * max6675 on uno: the reading comes back over the bus.
 *
 * The chip answers with sixteen bits, so the check compares what the sketch
 * read with the temperature the probe is at -- the quarter-degree step and
 * all.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function max6675Checks(build: GalleryBuild): CheckDef[] {
  const module = build.circuit.parts?.find((part) => part.type === 'max6675')?.id;
  return [
    {
      name: 'the reading comes back the way the probe is set',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading comes back the way the probe is set';
        const knob = sim.knob;
        if (knob === undefined || module === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /celsius ([\d.]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a reading');
        }
        const read = Number(reported[1]);
        const expected = knob(module, 'probe');
        if (Math.abs(read - expected) > 0.25) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${read} and the probe is at ${expected}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
