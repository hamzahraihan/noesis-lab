/* ------------------------------------------------------------------ *
 * dht22 on uno: the reading follows the temperature knob.
 *
 * The sensor puts a temperature-scaled voltage on DATA, the Uno's ADC maps
 * five volts across 1024 counts, and the sketch converts back to Celsius.
 * The reported value has to agree with the knob within two degrees. */

import { DHT22_TEMPERATURE_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function dht22Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'dht22')?.id;
  return [
    {
      name: 'the reading follows the temperature knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the temperature knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knobs');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /temp ([\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a temperature');
        }
        const temp = Number(reported[1]);
        const expectedTemp = knob(sensor, DHT22_TEMPERATURE_KNOB.id);
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
