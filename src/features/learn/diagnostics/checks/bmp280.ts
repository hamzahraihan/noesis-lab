/* ------------------------------------------------------------------ *
 * bmp280 on uno: the reading matches the pressure and temperature knobs.
 *
 * The chip answers with raw counts over I2C, and the sketch applies the
 * datasheet's compensation with calibration coefficients it read itself.
 * The check compares what the sketch reported with what the knobs say.
 * ------------------------------------------------------------------ */

import { BMP280_PRESSURE_KNOB, BMP280_TEMPERATURE_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function bmp280Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'bmp280-barometer')?.id;
  return [
    {
      name: 'pressure and temperature follow the knobs',
      run: (sim) => {
        const started = performance.now();
        const name = 'pressure and temperature follow the knobs';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read sensor knobs');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const log = sim.serialText();
        const pressureMatch = /pressure ([\d.]+) hPa/.exec(log);
        const temperatureMatch = /temperature ([\d.-]+) C/.exec(log);
        if (pressureMatch === null || temperatureMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report pressure and temperature');
        }
        const pressure = Number(pressureMatch[1]);
        const temperature = Number(temperatureMatch[1]);
        const expectedPressure = knob(sensor, BMP280_PRESSURE_KNOB.id);
        const expectedTemperature = knob(sensor, BMP280_TEMPERATURE_KNOB.id);
        if (Math.abs(pressure - expectedPressure) > 1) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${pressure} hPa and the knob is at ${expectedPressure}`,
          );
        }
        if (Math.abs(temperature - expectedTemperature) > 1) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${temperature} C and the knob is at ${expectedTemperature}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
