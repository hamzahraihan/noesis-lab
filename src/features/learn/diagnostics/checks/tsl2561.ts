/* ------------------------------------------------------------------ *
 * tsl2561 on uno: the reading follows the light knob.
 *
 * The sensor reports channel 0 and channel 1 counts. The sketch reads
 * four bytes and prints channel 0. The reported value has to agree
 * with the knob.
 * ------------------------------------------------------------------ */

import { TSL2561_LIGHT_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function tsl2561Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'tsl2561-light')?.id;
  return [
    {
      name: 'the reading follows the light knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the light knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /ch0 ([\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a channel 0 count');
        }
        const ch0 = Number(reported[1]);
        const expectedLux = knob(sensor, TSL2561_LIGHT_KNOB.id);
        const expectedCh0 = Math.round(expectedLux * 1.2);
        if (Math.abs(ch0 - expectedCh0) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${ch0} and the knob is at ${expectedCh0}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
