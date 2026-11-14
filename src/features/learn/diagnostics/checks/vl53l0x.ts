/* ------------------------------------------------------------------ *
 * vl53l0x on uno: the distance matches the distance knob.
 *
 * The chip answers with raw millimetre counts over I2C. The check compares
 * what the sketch reported with what the knob says.
 * ------------------------------------------------------------------ */

import { VL53L0X_DISTANCE_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function vl53l0xChecks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'vl53l0x-distance')?.id;
  return [
    {
      name: 'the reading follows the distance knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the distance knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /distance ([\d]+) mm/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a distance');
        }
        const read = Number(reported[1]);
        const expected = knob(sensor, VL53L0X_DISTANCE_KNOB.id);
        if (Math.abs(read - expected) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${read} mm and the knob is at ${expected}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
