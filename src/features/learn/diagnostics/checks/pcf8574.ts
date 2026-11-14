/* ------------------------------------------------------------------ *
 * pcf8574 on uno: one byte, and eight lights that agree with it.
 *
 * The expander is the answer to a board that has run out of pins, so what
 * matters is that the byte the sketch wrote is the byte the lights show.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function pcf8574Checks(build: GalleryBuild): CheckDef[] {
  const leds =
    build.circuit.parts?.filter((part) => part.type === 'led-red').map((part) => part.id) ?? [];
  return [
    {
      name: 'the eight lights show the count the log reports',
      run: (sim) => {
        const started = performance.now();
        const name = 'the eight lights show the count the log reports';
        const read = sim.partVolts;
        if (read === undefined || leds.length === 0) {
          return verdict(name, started, 'skip', 'the bench cannot read the lights');
        }
        /*
         * The lights and the log are read on the same frame. The sketch writes
         * the counter, prints it, then increments -- so a count read after the
         * run and lights read from the last frame are two different moments, and
         * the comparison would be against a byte the log never named.
         */
        let value = -1;
        const lit = new Array<boolean>(leds.length).fill(false);
        for (let frame = 0; frame < 60 && value < 0; frame++) {
          sim.tick(0.05);
          const reported = /count (\d+)/.exec(sim.serialText());
          if (reported === null) continue;
          value = Number(reported[1]);
          for (let bit = 0; bit < leds.length; bit++) {
            lit[bit] = read(leds[bit]!, 'anode') > 1;
          }
        }
        if (value < 0) {
          return verdict(name, started, 'fail', 'the sketch did not report a count');
        }
        let wrong = 0;
        for (let bit = 0; bit < leds.length; bit++) {
          const shouldBeLit = ((value >> bit) & 1) === 1;
          if (lit[bit] !== shouldBeLit) wrong += 1;
        }
        if (wrong > 0) {
          return verdict(
            name,
            started,
            'fail',
            `${wrong} of the ${leds.length} lights did not match the count`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
