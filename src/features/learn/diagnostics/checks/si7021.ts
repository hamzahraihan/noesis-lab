/* ------------------------------------------------------------------ *
 * si7021 on uno: the reading follows the temperature knob.
 *
 * The sensor reports humidity (0xF3) and temperature (0xE0). The sketch
 * reads both and prints temperature. The reported value has to agree
 * with the knob.
 * ------------------------------------------------------------------ */

import { SI7021_TEMPERATURE_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function si7021Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'si7021-temp-humidity')?.id;
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
        const reported = /temp ([\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a temperature');
        }
        const temp = Number(reported[1]);
        const expectedTemp = knob(sensor, SI7021_TEMPERATURE_KNOB.id);
        if (Math.abs(temp - expectedTemp) > 2) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${temp} C and the knob is at ${expectedTemp}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
