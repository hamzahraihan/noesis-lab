/* ------------------------------------------------------------------ *
 * adxl345 on uno: the reading follows the X acceleration knob.
 *
 * The sensor reports X, Y, Z acceleration on registers 0x32-0x37. The
 * sketch reads the six bytes and prints X. The reported value has to
 * agree with the knob.
 * ------------------------------------------------------------------ */

import { ADXL345_X_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function adxl345Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'adxl345-accel')?.id;
  return [
    {
      name: 'the reading follows the X acceleration knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the X acceleration knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /x ([-\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report an X acceleration');
        }
        const x = Number(reported[1]);
        const expectedX = knob(sensor, ADXL345_X_KNOB.id);
        const expectedRaw = Math.round((expectedX * 1000) / 3.9);
        if (Math.abs(x - expectedRaw) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${x} and the knob is at ${expectedRaw}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
