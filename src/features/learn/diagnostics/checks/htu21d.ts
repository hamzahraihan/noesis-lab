/* ------------------------------------------------------------------ *
 * htu21d on uno: the reading follows the temperature and humidity knobs.
 *
 * The sensor reports temperature and humidity as raw words over I2C.
 * The reported values have to agree with the knobs.
 * ------------------------------------------------------------------ */

import { HTU21D_TEMPERATURE_KNOB, HTU21D_HUMIDITY_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function htu21dChecks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'htu21d-temp-humidity')?.id;
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
        const reported = /temp ([\d.]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a temperature');
        }
        const temp = Number(reported[1]);
        const expectedTemp = knob(sensor, HTU21D_TEMPERATURE_KNOB.id);
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
    {
      name: 'the reading follows the humidity knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the humidity knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 60; frame++) sim.tick(0.05);
        const reported = /rh ([\d.]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report humidity');
        }
        const rh = Number(reported[1]);
        const expectedHumidity = knob(sensor, HTU21D_HUMIDITY_KNOB.id);
        if (Math.abs(rh - expectedHumidity) > 2) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${rh} % and the knob is at ${expectedHumidity}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
