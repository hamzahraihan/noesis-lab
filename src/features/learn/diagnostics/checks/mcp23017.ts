/* ------------------------------------------------------------------ *
 * mcp23017 on uno: sixteen pins, one sixteen-bit number.
 *
 * The expander's latches are its own state, so the check watches the lights
 * the two ports drive and compares them with the last number the sketch
 * printed -- sixteen bits, low byte on port A and high byte on port B.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function mcp23017Checks(build: GalleryBuild): CheckDef[] {
  const leds =
    build.circuit.parts?.filter((part) => part.type === 'led-red').map((part) => part.id) ?? [];
  return [
    {
      name: 'the sixteen lights show the count the log reports',
      run: (sim) => {
        const started = performance.now();
        const name = 'the sixteen lights show the count the log reports';
        const read = sim.partVolts;
        if (read === undefined || leds.length !== 16) {
          return verdict(name, started, 'skip', 'the bench cannot read the lights');
        }
        for (let frame = 0; frame < 60; frame++) sim.tick(0.05);
        const counts = [...sim.serialText().matchAll(/count (\d+)/g)].map((match) =>
          Number(match[1]),
        );
        if (counts.length === 0) {
          return verdict(name, started, 'fail', 'the sketch did not report a count');
        }
        const value = counts[counts.length - 1]!;
        let wrong = 0;
        for (let bit = 0; bit < leds.length; bit++) {
          const isLit = read(leds[bit]!, 'anode') > 1;
          const shouldBeLit = ((value >> bit) & 1) === 1;
          if (isLit !== shouldBeLit) wrong += 1;
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
