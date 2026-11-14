/* ------------------------------------------------------------------ *
 * bme280 on uno: the raw counts follow the knobs.
 *
 * The chip answers with raw counts over I2C. The check compares what the
 * sketch reported with what the knobs say.
 * ------------------------------------------------------------------ */

import { BME280_PRESSURE_KNOB, BME280_TEMPERATURE_KNOB, BME280_HUMIDITY_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function bme280Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'bme280-environment')?.id;
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
        const tempMatch = /raw temp ([\d]+)/.exec(log);
        const pressMatch = /raw press ([\d]+)/.exec(log);
        const humMatch = /raw hum ([\d]+)/.exec(log);
        if (tempMatch === null || pressMatch === null || humMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report raw counts');
        }
        const temp = Number(tempMatch[1]);
        const press = Number(pressMatch[1]);
        const hum = Number(humMatch[1]);
        const expectedTemp = knob(sensor, BME280_TEMPERATURE_KNOB.id);
        const expectedPress = knob(sensor, BME280_PRESSURE_KNOB.id);
        const expectedHum = knob(sensor, BME280_HUMIDITY_KNOB.id);
        /*
         * The sketch prints the reading, not the twenty-bit word: it assembles
         * the counts and shifts them back to the value the datasheet's
         * conversion would give. So the check compares the printed number with
         * the knob in the knob's own unit.
         */
        if (Math.abs(temp - expectedTemp) > 1) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read temp ${temp} and the knob is at ${expectedTemp}`,
          );
        }
        if (Math.abs(press - expectedPress) > 1) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read pressure ${press} and the knob is at ${expectedPress}`,
          );
        }
        // The humidity word is a count, not a percent: the sketch prints the
        // raw sixteen-bit register, and the conversion is the learner's.
        if (Math.abs(hum - expectedHum * 16) > 16) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read humidity ${hum} and the knob is at ${expectedHum}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
