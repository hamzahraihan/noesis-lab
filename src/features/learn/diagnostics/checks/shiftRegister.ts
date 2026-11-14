/* ------------------------------------------------------------------ *
 * shift-register on uno: a byte goes in over SPI and the outputs follow.
 *
 * The chase moves one LED per step, so the row is watched over a whole
 * cycle: every output has to be driven at some point, and only one at a
 * time, because the chip holds one byte and not eight.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function shiftRegisterChecks(build: GalleryBuild): CheckDef[] {
  const register = build.circuit.parts?.find((part) => part.type === 'shift595')?.id;
  return [
    {
      name: 'the byte shifts in and the outputs follow it',
      run: (sim) => {
        const started = performance.now();
        const name = 'the byte shifts in and the outputs follow it';
        const read = sim.partVolts;
        if (read === undefined || register === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a part pin');
        }
        const lit = new Set<string>();
        let together = 0;
        for (let frame = 0; frame < 40; frame++) {
          sim.tick(0.05);
          let on = 0;
          for (let index = 0; index < 8; index++) {
            if (read(register, `Q${index}`) > 1) {
              lit.add(`Q${index}`);
              on += 1;
            }
          }
          if (on > 1) together = on;
        }
        if (lit.size === 0) {
          return verdict(name, started, 'fail', 'no output was ever driven');
        }
        if (lit.size < 8) {
          return verdict(
            name,
            started,
            'fail',
            `only ${lit.size} of the eight outputs were driven`,
          );
        }
        if (together > 1) {
          return verdict(name, started, 'fail', `${together} outputs were driven at once`);
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
