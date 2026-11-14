/* ------------------------------------------------------------------ *
 * parking on uno: the default echo reads 100 cm, the far band holds.
 *
 * The `beeps at the parking sensor` leg holds title assertions only, so
 * these checks follow the sketch at its default knob: 10 frames carry
 * two ~240 ms loop passes reporting `cm 100`, D10 drives high (echo
 * present) while the sub-100 and sub-30 bands and the D9 buzzer rest
 * low. Pin levels, not brightness. Verified live.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const parkingChecks: CheckDef[] = [
  {
    name: 'reports centimetres on serial',
    run: (sim) => {
      const started = performance.now();
      const name = 'reports centimetres on serial';
      for (let frame = 0; frame < 10; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('cm 100')) {
        return verdict(name, started, 'fail', 'no centimetre line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'far echo holds the band pins',
    run: (sim) => {
      const started = performance.now();
      const name = 'far echo holds the band pins';
      // Order-dependent: relies on "reports centimetres on serial" (its 10 frames ran the echo loop).
      if (
        sim.readGpio(10) !== true ||
        sim.readGpio(11) !== false ||
        sim.readGpio(12) !== false ||
        sim.readGpio(9) !== false
      ) {
        return verdict(name, started, 'fail', 'band pins mis-held');
      }
      return verdict(name, started, 'pass');
    },
  },
];
