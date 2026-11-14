/* ------------------------------------------------------------------ *
 * dashboard on uno: the knob parks mid-travel, the horn follows.
 *
 * The `sweeps the dashboard horn` leg holds title assertions only, so
 * these checks follow the sketch at its default wiper: 10 frames carry
 * two 200 ms loop passes reporting `knob 511 horn 90`, and the mid-third
 * pin (D7) drives high while D6/D8 rest low. Pin levels, not brightness:
 * the LED bar has no `HarnessSim` accessor. Verified live.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const dashboardChecks: CheckDef[] = [
  {
    name: 'reports knob and horn on serial',
    run: (sim) => {
      const started = performance.now();
      const name = 'reports knob and horn on serial';
      for (let frame = 0; frame < 10; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('knob 511 horn 90')) {
        return verdict(name, started, 'fail', 'no knob/horn line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'mid third selects the middle indicator',
    run: (sim) => {
      const started = performance.now();
      const name = 'mid third selects the middle indicator';
      // Order-dependent: relies on "reports knob and horn on serial" (its 10 frames ran the knob loop).
      if (sim.readGpio(6) !== false || sim.readGpio(7) !== true || sim.readGpio(8) !== false) {
        return verdict(name, started, 'fail', 'third pins mis-selected');
      }
      return verdict(name, started, 'pass');
    },
  },
];
