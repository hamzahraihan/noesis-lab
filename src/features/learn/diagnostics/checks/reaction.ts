/* ------------------------------------------------------------------ *
 * reaction on uno: arm, wait for the light, answer fast.
 *
 * The `times the reaction game` leg holds title assertions only, so
 * these checks follow the sketch directly: `setup` prompts `press to
 * arm`, a press-release-press inside the 2-5 s window prints
 * `false start`, and a full arm-wait-answer cycle prints
 * `latency <n> ms` with D8 driving high while the light is on. Each
 * edge holds 3 frames past the 25 ms debounce. Verified live.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const reactionChecks: CheckDef[] = [
  {
    name: 'prompts press to arm',
    run: (sim) => {
      const started = performance.now();
      const name = 'prompts press to arm';
      for (let frame = 0; frame < 3; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('press to arm')) {
        return verdict(name, started, 'fail', 'no arm prompt');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'early press calls the false start',
    run: (sim) => {
      const started = performance.now();
      const name = 'early press calls the false start';
      for (let round = 0; round < 2; round++) {
        sim.pressButton(0, true);
        for (let frame = 0; frame < 3; frame++) sim.tick(0.05);
        sim.pressButton(0, false);
        for (let frame = 0; frame < 3; frame++) sim.tick(0.05);
      }
      if (!sim.serialText().includes('false start')) {
        return verdict(name, started, 'fail', 'no false start line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'clean run reports latency',
    run: (sim) => {
      const started = performance.now();
      const name = 'clean run reports latency';
      sim.pressButton(0, true);
      for (let frame = 0; frame < 3; frame++) sim.tick(0.05);
      sim.pressButton(0, false);
      for (let frame = 0; frame < 3; frame++) sim.tick(0.05);
      sim.jumpTimeMs(6000);
      let lit = false;
      for (let frame = 0; frame < 40 && !lit; frame++) {
        sim.tick(0.05);
        lit = sim.readGpio(8);
      }
      if (!lit) return verdict(name, started, 'fail', 'light never came on');
      sim.pressButton(0, true);
      for (let frame = 0; frame < 3; frame++) sim.tick(0.05);
      sim.pressButton(0, false);
      for (let frame = 0; frame < 3; frame++) sim.tick(0.05);
      if (!/latency \d+ ms/.test(sim.serialText())) {
        return verdict(name, started, 'fail', 'no latency line');
      }
      return verdict(name, started, 'pass');
    },
  },
];
