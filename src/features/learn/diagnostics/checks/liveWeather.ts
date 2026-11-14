/* ------------------------------------------------------------------ *
 * live-weather on esp32: the one project that asks a real host.
 *
 * The harness is offline by design -- `makeSimFor` builds a bench with no live
 * bridge -- so these checks pin the half that is this repository's to pin: the
 * join, the request going out, and a host that cannot answer being *reported*
 * rather than waited on. What open-meteo returns is somebody else's business,
 * and a check that needed it would fail whenever the internet does.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const liveWeatherChecks: CheckDef[] = [
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
    name: 'reports a live host that did not answer',
    run: (sim) => {
      const started = performance.now();
      const name = 'reports a live host that did not answer';
      // The loop asks every two seconds; a bench with no bridge answers the
      // name the way it answers any unknown host -- after its own latency.
      for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('live network failed')) {
        return verdict(name, started, 'fail', 'the failure was not reported');
      }
      return verdict(name, started, 'pass');
    },
  },
];
