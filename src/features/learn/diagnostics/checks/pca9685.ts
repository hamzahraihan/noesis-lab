/* ------------------------------------------------------------------ *
 * pca9685 on uno: sixteen channels, sixteen duties.
 *
 * A PWM output is a switched resistor, not a level, so the check samples a
 * whole frame and counts how often each light is high. One sixteenth of a
 * 50 Hz frame is 1.25 ms, and 80 samples at 0.25 ms put five of them inside
 * the high part; the tolerance covers sampling on a count boundary.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function pca9685Checks(build: GalleryBuild): CheckDef[] {
  const leds =
    build.circuit.parts?.filter((part) => part.type === 'led-red').map((part) => part.id) ?? [];
  return [
    {
      name: 'the sixteen lights step from one sixteenth to full',
      run: (sim) => {
        const started = performance.now();
        const name = 'the sixteen lights step from one sixteenth to full';
        const read = sim.partVolts;
        if (read === undefined || leds.length !== 16) {
          return verdict(name, started, 'skip', 'the bench cannot read the lights');
        }
        for (let frame = 0; frame < 20; frame++) sim.tick(0.05);
        if (!sim.serialText().includes('sixteen levels')) {
          return verdict(name, started, 'fail', 'the sketch did not set the levels');
        }
        const samples = 80;
        const highs = new Array<number>(16).fill(0);
        for (let sample = 0; sample < samples; sample++) {
          sim.tick(0.00025);
          for (let channel = 0; channel < 16; channel++) {
            if (read(leds[channel]!, 'anode') > 1) highs[channel] += 1;
          }
        }
        let wrong = 0;
        for (let channel = 0; channel < 16; channel++) {
          const expected = ((channel + 1) / 16) * samples;
          if (Math.abs(highs[channel]! - expected) > 2) wrong += 1;
        }
        if (wrong > 0) {
          return verdict(
            name,
            started,
            'fail',
            `${wrong} of the 16 lights did not hold their duty (${highs.join(', ')} of ${samples})`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
