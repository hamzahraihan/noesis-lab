/* ------------------------------------------------------------------ *
 * hmc5883l on uno: the reading follows the X field knob.
 *
 * The sensor reports X, Z, Y magnetic field on registers 0x03-0x08. The
 * sketch reads six bytes and prints X. The reported value has to agree
 * with the knob.
 * ------------------------------------------------------------------ */

import { HMC5883L_X_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function hmc5883lChecks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'hmc5883l-compass')?.id;
  return [
    {
      name: 'the reading follows the X field knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the X field knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /x ([-\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report an X field');
        }
        const x = Number(reported[1]);
        const expectedX = knob(sensor, HMC5883L_X_KNOB.id);
        const expectedRaw = Math.round((expectedX * 1000) / 0.92);
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
