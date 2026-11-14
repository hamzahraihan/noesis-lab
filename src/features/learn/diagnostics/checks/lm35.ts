/* ------------------------------------------------------------------ *
 * lm35 on uno: the temperature the sketch reads is the knob's degrees.
 *
 * The sensor puts 10 mV per degree on Vout, the Uno's ADC maps five volts
 * across 1024 counts, and the sketch converts back. The sketch's reported
 * temperature has to agree with the knob within a degree.
 * ------------------------------------------------------------------ */

import { LM35_TEMPERATURE_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function lm35Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'lm35')?.id;
  return [
    {
      name: 'the reading follows the temperature knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the temperature knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /temperature ([\d-]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a temperature');
        }
        const read = Number(reported[1]);
        const expected = knob(sensor, LM35_TEMPERATURE_KNOB.id);
        if (Math.abs(read - expected) > 1) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${read} and the knob is at ${expected}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
