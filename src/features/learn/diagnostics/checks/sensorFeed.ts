/* ------------------------------------------------------------------ *
 * sensor-feed on esp32: subscribe, then receive once a second.
 *
 * The receive loop is the point, so the checks follow the serial: the
 * subscription is accepted, readings arrive, and the second one is a *later*
 * reading rather than the retained first one repeated.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const sensorFeedChecks: CheckDef[] = [
  {
    name: 'subscribes to the sensor',
    run: (sim) => {
      const started = performance.now();
      const name = 'subscribes to the sensor';
      for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('subscribed 1')) {
        return verdict(name, started, 'fail', 'no subscription line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'receives the retained reading',
    run: (sim) => {
      const started = performance.now();
      const name = 'receives the retained reading';
      for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
      if (!/temp 20\.0/.test(sim.serialText())) {
        return verdict(name, started, 'fail', 'no first reading');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'tells the sensor how often to publish',
    run: (sim) => {
      const started = performance.now();
      const name = 'tells the sensor how often to publish';
      for (let frame = 0; frame < 4; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('asked for 2s 1')) {
        return verdict(name, started, 'fail', 'the order was not accepted');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'receives later readings as they are published',
    run: (sim) => {
      const started = performance.now();
      const name = 'receives later readings as they are published';
      // Two seconds per reading: by now the feed must have advanced at least
      // twice (20.5 at two seconds, 21.0 at four).
      for (let frame = 0; frame < 80; frame++) sim.tick(0.05);
      if (!/temp 20\.5/.test(sim.serialText()) || !/temp 21\.0/.test(sim.serialText())) {
        return verdict(name, started, 'fail', 'the feed did not advance');
      }
      return verdict(name, started, 'pass');
    },
  },
];
