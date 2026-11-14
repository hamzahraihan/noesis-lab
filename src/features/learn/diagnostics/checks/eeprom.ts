/* ------------------------------------------------------------------ *
 * eeprom24lc256 on uno: the count lives in the memory, not in the sketch.
 *
 * A chip that forgot would start the count again, so a count that climbs
 * by one every time is the proof that the memory kept it.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export function eepromChecks(): CheckDef[] {
  return [
    {
      name: 'the memory keeps the count the sketch wrote',
      run: (sim) => {
        const started = performance.now();
        const name = 'the memory keeps the count the sketch wrote';
        for (let frame = 0; frame < 60; frame++) sim.tick(0.05);
        const counts = [...sim.serialText().matchAll(/count (\d+)/g)].map((match) =>
          Number(match[1]),
        );
        if (counts.length < 2) {
          return verdict(name, started, 'fail', 'the sketch did not report a count');
        }
        for (let index = 1; index < counts.length; index++) {
          if (counts[index] !== counts[index - 1]! + 1) {
            return verdict(
              name,
              started,
              'fail',
              `the count went ${counts[index - 1]} to ${counts[index]}`,
            );
          }
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
