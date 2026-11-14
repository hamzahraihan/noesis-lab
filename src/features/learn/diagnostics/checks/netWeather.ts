/* ------------------------------------------------------------------ *
 * net-weather on esp32: two bench hosts, one radio, one request at a time.
 *
 * The rotation is the check: the serial has to carry the clock from
 * `ntp.noesis` and both readings from `sensor.noesis`, which can only happen
 * if the loop resets and moves on after each answer.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const netWeatherChecks: CheckDef[] = [
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
    name: 'fetches the time from ntp.noesis',
    run: (sim) => {
      const started = performance.now();
      const name = 'fetches the time from ntp.noesis';
      for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
      if (!/time 2026-10-17T12:00:\d\dZ/.test(sim.serialText())) {
        return verdict(name, started, 'fail', 'no time line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'fetches the readings from sensor.noesis',
    run: (sim) => {
      const started = performance.now();
      const name = 'fetches the readings from sensor.noesis';
      for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
      if (!/temp 2\d\.\d/.test(sim.serialText())) {
        return verdict(name, started, 'fail', 'no temperature line');
      }
      if (!/humidity 4\d\.\d/.test(sim.serialText())) {
        return verdict(name, started, 'fail', 'no humidity line');
      }
      return verdict(name, started, 'pass');
    },
  },
];
