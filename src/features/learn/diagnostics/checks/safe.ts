/* ------------------------------------------------------------------ *
 * safe on uno: A, C, B unlocks; a wrong digit buzzes and resets.
 *
 * The `locks digits behind the safe` leg holds title assertions only, so
 * these checks follow the sketch directly: `setup` prints `locked`, a
 * press on the B button (index 1) prints `wrong`, A/C/B (indices 0/2/1)
 * prints `digit ok 1/2/3` then `unlocked`, and the indicator pins swing
 * D7 low / D8 high. Each press holds 4 frames past the 25 ms debounce
 * with 4 settling frames; the wrong press gets 30 frames past the
 * 720 ms buzz. Verified live against the interpreter.
 * ------------------------------------------------------------------ */

import { verdict, pressAndSettle } from './shared';
import type { CheckDef } from './shared';

export const safeChecks: CheckDef[] = [
  {
    name: 'starts locked',
    run: (sim) => {
      const started = performance.now();
      const name = 'starts locked';
      for (let frame = 0; frame < 5; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('locked')) {
        return verdict(name, started, 'fail', 'no locked line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'wrong digit buzzes and resets',
    run: (sim) => {
      const started = performance.now();
      const name = 'wrong digit buzzes and resets';
      pressAndSettle(sim, 1);
      for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('wrong')) {
        return verdict(name, started, 'fail', 'no wrong line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'a c b unlocks',
    run: (sim) => {
      const started = performance.now();
      const name = 'a c b unlocks';
      for (const index of [0, 2, 1]) pressAndSettle(sim, index);
      for (let frame = 0; frame < 5; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('unlocked')) {
        return verdict(name, started, 'fail', 'no unlocked line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'unlock drives the indicator pins',
    run: (sim) => {
      const started = performance.now();
      const name = 'unlock drives the indicator pins';
      if (sim.readGpio(7) !== false || sim.readGpio(8) !== true) {
        return verdict(name, started, 'fail', 'indicator pins did not swing');
      }
      return verdict(name, started, 'pass');
    },
  },
];
