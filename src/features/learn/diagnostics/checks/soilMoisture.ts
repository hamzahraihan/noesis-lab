/* ------------------------------------------------------------------ *
 * soil-moisture on uno: the reading follows the moisture knob.
 *
 * The sensor puts a fraction of the supply on AOUT, the Uno's ADC maps five
 * volts across 1024 counts, and the sketch converts back. The sketch's
 * reported moisture has to agree with the knob within a percent.
 * ------------------------------------------------------------------ */

import { MOISTURE_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function soilMoistureChecks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'soil-moisture')?.id;
  return [
    {
      name: 'the reading follows the moisture knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the moisture knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /moisture ([\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a moisture');
        }
        const read = Number(reported[1]);
        const expected = knob(sensor, MOISTURE_KNOB.id);
        if (Math.abs(read - expected) > 1) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${read} % and the knob is at ${expected}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
