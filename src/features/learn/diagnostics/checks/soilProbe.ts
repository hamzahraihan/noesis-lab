/* ------------------------------------------------------------------ *
 * soil-probe on uno: the behaviour-part worked example.
 *
 * The part is not in the catalogue: its definition travels inside the
 * circuit document, and its behaviour is a script the bench runs. Mirrors
 * `runs the scripted probe live: the knob is the sensor` (the runtime
 * awaited, 1.5 s of ticks, the knob's default fraction on the serial) --
 * the knob turn itself stays in the gallery leg, which has the bench.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const soilProbeChecks: CheckDef[] = [
  {
    name: 'reads the scripted probe on A0',
    run: async (sim) => {
      const started = performance.now();
      const name = 'reads the scripted probe on A0';
      await sim.scriptedReady?.();
      for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
      const match = /moisture (\d+)%/.exec(sim.serialText());
      if (match === null) return verdict(name, started, 'fail', 'no moisture line on the serial');
      const percent = Number(match[1]);
      // The definition's knob default is 40, and the ADC reads the divider.
      if (percent < 30 || percent > 50) {
        return verdict(name, started, 'fail', `moisture ${percent}% at the knob default`);
      }
      return verdict(name, started, 'pass', `moisture ${percent}%`);
    },
  },
];
