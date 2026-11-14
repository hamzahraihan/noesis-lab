/* ------------------------------------------------------------------ *
 * rfid on uno: the chip answers on the bus, and the card changes what it
 * answers.
 *
 * The reader has no glass and drives no pin the bench can read: everything
 * it says goes out on MISO and comes back through the sketch's serial
 * output. So the check watches the log, in the order a reader meets the
 * chip's states -- version, an empty field, a card, an empty field again.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const rfidChecks: CheckDef[] = [
  {
    name: 'the reader reports its version, times out, and sees a card',
    run: (sim) => {
      const started = performance.now();
      const name = 'the reader reports its version, times out, and sees a card';
      if (sim.setCard === undefined) {
        return verdict(name, started, 'skip', 'the bench cannot put a card in the field');
      }
      const waitFor = (text: string, frames: number): boolean => {
        for (let frame = 0; frame < frames; frame++) {
          sim.tick(0.05);
          if (sim.serialText().includes(text)) return true;
        }
        return false;
      };
      if (!waitFor('version 92', 40)) {
        return verdict(name, started, 'fail', 'the version register did not come back');
      }
      if (!waitFor('no card', 40)) {
        return verdict(name, started, 'fail', 'an empty field did not time out');
      }
      sim.setCard(true);
      if (!waitFor('card 4 0', 60)) {
        return verdict(name, started, 'fail', 'a card in the field was not read');
      }
      sim.setCard(false);
      const before = sim.serialText().length;
      for (let frame = 0; frame < 60; frame++) sim.tick(0.05);
      if (!sim.serialText().slice(before).includes('no card')) {
        return verdict(name, started, 'fail', 'the reader answered with no card there');
      }
      return verdict(name, started, 'pass');
    },
  },
];
