/* ------------------------------------------------------------------ *
 * max30100 on uno: the reading follows the heart rate knob.
 *
 * The sensor reports IR and red counts. The sketch reads four bytes
 * and prints IR. The reported value has to agree with the knob.
 * ------------------------------------------------------------------ */

import { MAX30100_HEART_RATE_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function max30100Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'max30100-pulse')?.id;
  return [
    {
      name: 'the reading follows the heart rate knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the heart rate knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /ir ([\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report an IR count');
        }
        const ir = Number(reported[1]);
        const expectedHr = knob(sensor, MAX30100_HEART_RATE_KNOB.id);
        const expectedIr = expectedHr * 16;
        if (Math.abs(ir - expectedIr) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${ir} and the knob is at ${expectedIr}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
