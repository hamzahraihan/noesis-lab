/* ------------------------------------------------------------------ *
 * weather on uno: one serial line per 2 s reading.
 *
 * The `logs the weather station` leg holds title assertions only, and
 * the LCD model has no `HarnessSim` accessor, so these checks read the
 * serial mirror over the LCD leg's 120 frames: three readings of
 * `t 25 C rh 50 %` at the default knobs. Verified live.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const weatherChecks: CheckDef[] = [
  {
    name: 'logs temperature on serial',
    run: (sim) => {
      const started = performance.now();
      const name = 'logs temperature on serial';
      for (let frame = 0; frame < 120; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('t 25 C')) {
        return verdict(name, started, 'fail', 'no temperature line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'logs humidity on serial',
    run: (sim) => {
      const started = performance.now();
      const name = 'logs humidity on serial';
      // Order-dependent: relies on "logs temperature on serial" (its 120 frames produced the readings).
      if (!sim.serialText().includes('rh 50 %')) {
        return verdict(name, started, 'fail', 'no humidity line');
      }
      return verdict(name, started, 'pass');
    },
  },
];
