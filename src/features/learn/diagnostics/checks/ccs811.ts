/* ------------------------------------------------------------------ *
 * ccs811 on uno: the reading follows the eCO2 knob.
 *
 * The sensor reports eCO2 and TVOC on ALG_RESULT_DATA. The sketch reads
 * four bytes and prints eCO2. The reported value has to agree with the
 * knob.
 * ------------------------------------------------------------------ */

import { CCS811_ECO2_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function ccs811Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'ccs811-air-quality')?.id;
  return [
    {
      name: 'the reading follows the eCO2 knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the eCO2 knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /eco2 ([\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report an eCO2 value');
        }
        const eco2 = Number(reported[1]);
        const expectedEco2 = knob(sensor, CCS811_ECO2_KNOB.id);
        if (Math.abs(eco2 - expectedEco2) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${eco2} and the knob is at ${expectedEco2}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
