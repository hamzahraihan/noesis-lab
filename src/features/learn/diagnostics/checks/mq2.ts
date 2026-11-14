/* ------------------------------------------------------------------ *
 * mq2 on uno: the reading follows the gas concentration knob.
 *
 * The sensor puts a fraction of the supply on AOUT (0 ppm to 1000 ppm over
 * 0 V to 5 V), the Uno's ADC maps five volts across 1024 counts, and the
 * sketch converts back to ppm. The sketch's reported ppm has to agree with
 * the knob within a few ppm.
 * ------------------------------------------------------------------ */

import { MQ2_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function mq2Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'mq2')?.id;
  return [
    {
      name: 'the reading follows the gas concentration knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the gas concentration knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /gas ([\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a gas concentration');
        }
        const read = Number(reported[1]);
        const expected = knob(sensor, MQ2_KNOB.id);
        if (Math.abs(read - expected) > 10) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${read} ppm and the knob is at ${expected}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
