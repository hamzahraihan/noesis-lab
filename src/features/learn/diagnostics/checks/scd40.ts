/* ------------------------------------------------------------------ *
 * scd40 on uno: the raw counts follow the CO2, temperature and humidity knobs.
 *
 * The chip answers with sixteen-bit raw counts over I2C. The check converts
 * them back with the scale the model uses and compares with the knobs.
 * ------------------------------------------------------------------ */

import { SCD40_CO2_KNOB, SCD40_TEMPERATURE_KNOB, SCD40_HUMIDITY_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function scd40Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'scd40-co2')?.id;
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
        const co2Match = /co2 ([\d]+)/.exec(log);
        const tempMatch = /temp ([\d]+)/.exec(log);
        const humMatch = /hum ([\d]+)/.exec(log);
        if (co2Match === null || tempMatch === null || humMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report raw counts');
        }
        const co2 = Number(co2Match[1]) / 16;
        const temperature = Number(tempMatch[1]) / 16;
        const humidity = Number(humMatch[1]) / 16;
        const expectedCo2 = knob(sensor, SCD40_CO2_KNOB.id);
        const expectedTemperature = knob(sensor, SCD40_TEMPERATURE_KNOB.id);
        const expectedHumidity = knob(sensor, SCD40_HUMIDITY_KNOB.id);
        if (Math.abs(co2 - expectedCo2) > 20) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read CO2 ${co2} and the knob is at ${expectedCo2}`,
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
        if (Math.abs(humidity - expectedHumidity) > 2) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read humidity ${humidity} and the knob is at ${expectedHumidity}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
