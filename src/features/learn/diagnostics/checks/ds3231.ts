/* ------------------------------------------------------------------ *
 * ds3231 on uno: a clock that lost power is set, then trusted.
 *
 * The status flag is the chip's own register, so the check follows what the
 * sketch reports after it clears the flag: the time it wrote, the die
 * temperature it read back, and the light toggling with the seconds.
 * ------------------------------------------------------------------ */

import { DS3231_TEMPERATURE_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function ds3231Checks(build: GalleryBuild): CheckDef[] {
  const clock = build.circuit.parts?.find((part) => part.type === 'ds3231-rtc')?.id;
  const led = build.circuit.parts?.find((part) => part.type === 'led-red')?.id;
  return [
    {
      name: 'sets a clock that lost power, then keeps time',
      run: (sim) => {
        const started = performance.now();
        const name = 'sets a clock that lost power, then keeps time';
        const read = sim.partVolts;
        const knob = sim.knob;
        if (read === undefined || knob === undefined || clock === undefined || led === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the clock');
        }
        const litStates = new Set<boolean>();
        for (let frame = 0; frame < 60; frame++) {
          sim.tick(0.05);
          litStates.add(read(led, 'anode') > 1);
        }
        const log = sim.serialText();
        if (!log.includes('lost power') || !log.includes('clock set')) {
          return verdict(name, started, 'fail', 'the lost-power flag was not cleared');
        }
        if (!log.includes('time 20261024 9:30:0')) {
          return verdict(name, started, 'fail', 'the sketch did not read back the time it set');
        }
        const reported = /celsius ([\d.-]+)/.exec(log);
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a reading');
        }
        const die = knob(clock, DS3231_TEMPERATURE_KNOB.id);
        if (Math.abs(Number(reported[1]) - die) > 0.25) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${reported[1]} and the die is at ${die}`,
          );
        }
        if (litStates.size !== 2) {
          return verdict(name, started, 'fail', 'the light never toggled with the seconds');
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
