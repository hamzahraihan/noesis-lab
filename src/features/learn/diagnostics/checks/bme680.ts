/* ------------------------------------------------------------------ *
 * bme680 on uno: the raw counts follow the pressure, temperature,
 * humidity and gas knobs.
 *
 * The chip answers with raw counts over I2C. The check converts them back
 * with the scale the model uses and compares with the knobs.
 * ------------------------------------------------------------------ */

import { BME680_PRESSURE_KNOB, BME680_TEMPERATURE_KNOB, BME680_HUMIDITY_KNOB, BME680_GAS_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function bme680Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'bme680-gas')?.id;
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
        const pressMatch = /press ([\d]+)/.exec(log);
        const tempMatch = /temp ([\d]+)/.exec(log);
        const humMatch = /hum ([\d]+)/.exec(log);
        const gasMatch = /gas ([\d]+)/.exec(log);
        if (pressMatch === null || tempMatch === null || humMatch === null || gasMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report raw counts');
        }
        const pressure = Number(pressMatch[1]) / 16;
        const temperature = Number(tempMatch[1]) / 16;
        const humidity = Number(humMatch[1]) / 16;
        const gas = Number(gasMatch[1]) * 10;
        const expectedPressure = knob(sensor, BME680_PRESSURE_KNOB.id);
        const expectedTemperature = knob(sensor, BME680_TEMPERATURE_KNOB.id);
        const expectedHumidity = knob(sensor, BME680_HUMIDITY_KNOB.id);
        const expectedGas = knob(sensor, BME680_GAS_KNOB.id);
        if (Math.abs(pressure - expectedPressure) > 2) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read pressure ${pressure} and the knob is at ${expectedPressure}`,
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
        if (Math.abs(gas - expectedGas) > 200) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read gas ${gas} and the knob is at ${expectedGas}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
