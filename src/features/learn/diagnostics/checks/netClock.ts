/* ------------------------------------------------------------------ *
 * net-clock on esp32: join the bench network, ask it the time, repeat.
 *
 * The only project whose data does not come from the board, so its checks
 * follow the serial: the join prints the address the network handed out, and
 * the loop prints the bench clock once per second -- which is also proof that
 * it kept asking rather than reading once.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const netClockChecks: CheckDef[] = [
  {
    name: 'joins the bench network',
    run: (sim) => {
      const started = performance.now();
      const name = 'joins the bench network';
      for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('joined 192.168.4.10')) {
        return verdict(name, started, 'fail', 'no join line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'fetches the time from the network',
    run: (sim) => {
      const started = performance.now();
      const name = 'fetches the time from the network';
      // The join check already spent its frames; the request needs its latency
      // and a poll or two on top.
      for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
      if (!/2026-10-17T12:00:0\dZ/.test(sim.serialText())) {
        return verdict(name, started, 'fail', 'no time line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'keeps asking once a second',
    run: (sim) => {
      const started = performance.now();
      const name = 'keeps asking once a second';
      for (let frame = 0; frame < 80; frame++) sim.tick(0.05);
      // Two different times, not a particular second: the loop asked again
      // rather than printing the first answer forever.
      const times = new Set(sim.serialText().match(/2026-10-17T12:00:\d\dZ/g) ?? []);
      if (times.size < 2) {
        return verdict(name, started, 'fail', 'the clock did not advance');
      }
      return verdict(name, started, 'pass');
    },
  },
];
