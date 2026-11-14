/* ------------------------------------------------------------------ *
 * aht20 on uno: the raw counts follow the temperature and humidity knobs.
 *
 * The chip answers with twenty-bit raw counts over I2C. The check converts
 * them back with the datasheet divisors and compares with the knobs.
 * ------------------------------------------------------------------ */

import { AHT20_TEMPERATURE_KNOB, AHT20_HUMIDITY_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function aht20Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'aht20-environment')?.id;
  return [
    {
      name: 'the raw counts follow the knobs',
      run: (sim) => {
        const started = performance.now();
        const name = 'the raw counts follow the knobs';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read sensor knobs');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const log = sim.serialText();
        const humMatch = /hum (-?[\d.]+)/.exec(log);
        const tempMatch = /temp (-?[\d.]+)/.exec(log);
        if (humMatch === null || tempMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report humidity and temperature');
        }
        // The sketch prints the twenty-bit counts; the conversion is the
        // learner's, so the check decodes them the way the datasheet does.
        const humidity = (Number(humMatch[1]) * 100) / 1048576;
        const temperature = (Number(tempMatch[1]) * 200) / 1048576 - 50;
        const expectedHumidity = knob(sensor, AHT20_HUMIDITY_KNOB.id);
        const expectedTemperature = knob(sensor, AHT20_TEMPERATURE_KNOB.id);
        if (Math.abs(humidity - expectedHumidity) > 2) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read humidity ${humidity} and the knob is at ${expectedHumidity}`,
          );
        }
        if (Math.abs(temperature - expectedTemperature) > 2) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read temperature ${temperature} and the knob is at ${expectedTemperature}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
