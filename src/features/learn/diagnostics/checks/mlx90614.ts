/* ------------------------------------------------------------------ *
 * mlx90614 on uno: the reading follows the ambient temperature knob.
 *
 * The sensor reports ambient temperature on register 0x06. The sketch
 * reads the register and converts the raw word back to Celsius. The
 * reported value has to agree with the knob.
 * ------------------------------------------------------------------ */

import { MLX90614_AMBIENT_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function mlx90614Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'mlx90614-ir-temp')?.id;
  return [
    {
      name: 'the reading follows the ambient temperature knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the ambient temperature knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /ambient ([\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report an ambient temperature');
        }
        const temp = Number(reported[1]);
        const expectedTemp = knob(sensor, MLX90614_AMBIENT_KNOB.id);
        if (Math.abs(temp - expectedTemp) > 5) {
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
