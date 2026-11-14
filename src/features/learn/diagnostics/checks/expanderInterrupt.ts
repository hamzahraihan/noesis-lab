/* ------------------------------------------------------------------ *
 * expander-interrupt on uno: a button the expander watches by itself.
 *
 * The sketch never polls the bus; the chip samples PA0 and pulls INTA, and
 * the light is the sketch's answer to that pin. The checks watch the log for
 * the two lines the sketch prints from the interrupt path, and the light for
 * the level it sets there. The pull-up is switched on before the watch starts
 * precisely so setup is not reported as a press, which is the first check.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, HarnessSim, GalleryBuild } from './shared';

export function expanderInterruptChecks(build: GalleryBuild): CheckDef[] {
  const leds =
    build.circuit.parts?.filter((part) => part.type === 'led-red').map((part) => part.id) ?? [];
  const lit = (sim: HarnessSim): boolean =>
    sim.partVolts !== undefined && leds.length === 1 && sim.partVolts(leds[0]!, 'anode') > 1;
  return [
    {
      name: 'setup starts the watch without reporting a press',
      run: (sim) => {
        const started = performance.now();
        const name = 'setup starts the watch without reporting a press';
        if (sim.partVolts === undefined || leds.length !== 1) {
          return verdict(name, started, 'skip', 'the bench cannot read the light');
        }
        for (let frame = 0; frame < 20; frame++) sim.tick(0.05);
        const text = sim.serialText();
        if (!text.includes('watching PA0')) {
          return verdict(name, started, 'fail', 'the sketch did not start the watch');
        }
        if (text.includes('pressed')) {
          return verdict(name, started, 'fail', 'the pull-up coming up was reported as a press');
        }
        if (lit(sim)) return verdict(name, started, 'fail', 'the light is on before any press');
        return verdict(name, started, 'pass');
      },
    },
    {
      name: 'a press wakes the sketch through INTA and the release puts the light out',
      run: (sim) => {
        const started = performance.now();
        const name = 'a press wakes the sketch through INTA and the release puts the light out';
        if (sim.partVolts === undefined || leds.length !== 1) {
          return verdict(name, started, 'skip', 'the bench cannot read the light');
        }
        sim.pressButton(0, true);
        for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
        if (!sim.serialText().includes('pressed')) {
          return verdict(name, started, 'fail', 'no pressed line: INTA did not wake the sketch');
        }
        if (!lit(sim)) return verdict(name, started, 'fail', 'the light stayed dark on the press');
        sim.pressButton(0, false);
        for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
        if (!sim.serialText().includes('released')) {
          return verdict(name, started, 'fail', 'no released line: the second edge was missed');
        }
        if (lit(sim))
          return verdict(name, started, 'fail', 'the light stayed lit after the release');
        return verdict(name, started, 'pass');
      },
    },
  ];
}
