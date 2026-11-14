/* ------------------------------------------------------------------ *
 * veml6075 on uno: the reading follows the UVA knob.
 *
 * The sensor reports UVA and UVB counts. The sketch reads four bytes
 * and prints UVA. The reported value has to agree with the knob.
 * ------------------------------------------------------------------ */

import { VEML6075_UVA_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function veml6075Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'veml6075-uv')?.id;
  return [
    {
      name: 'the reading follows the UVA knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the UVA knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /uva ([\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a UVA count');
        }
        const uva = Number(reported[1]);
        const expectedUva = knob(sensor, VEML6075_UVA_KNOB.id);
        if (Math.abs(uva - expectedUva) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${uva} and the knob is at ${expectedUva}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
