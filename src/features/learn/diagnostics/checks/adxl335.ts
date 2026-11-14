/* ------------------------------------------------------------------ *
 * adxl335 on uno: the readings follow the X, Y and Z knobs.
 *
 * The sensor puts mid-rail at rest and near the rail at full scale, the
 * Uno's ADC maps five volts across 1024 counts, and the sketch converts
 * back. The sketch's reported g has to agree with the knob within one.
 * ------------------------------------------------------------------ */

import { ADXL335_X_KNOB, ADXL335_Y_KNOB, ADXL335_Z_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function adxl335Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'adxl335')?.id;
  return [
    {
      name: 'the readings follow the axis knobs',
      run: (sim) => {
        const started = performance.now();
        const name = 'the readings follow the axis knobs';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the axis knobs');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const log = sim.serialText();
        const xMatch = /x ([-\d]+)/.exec(log);
        const yMatch = /y ([-\d]+)/.exec(log);
        const zMatch = /z ([-\d]+)/.exec(log);
        if (xMatch === null || yMatch === null || zMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report axis readings');
        }
        const cases: ReadonlyArray<readonly [string, string, string]> = [
          ['x', xMatch[1]!, ADXL335_X_KNOB.id],
          ['y', yMatch[1]!, ADXL335_Y_KNOB.id],
          ['z', zMatch[1]!, ADXL335_Z_KNOB.id],
        ];
        for (const [axis, text, knobId] of cases) {
          const read = Number(text);
          const expected = knob(sensor, knobId);
          if (Math.abs(read - expected) > 1) {
            return verdict(
              name,
              started,
              'fail',
              `the sketch read ${axis} ${read} and the knob is at ${expected}`,
            );
          }
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
