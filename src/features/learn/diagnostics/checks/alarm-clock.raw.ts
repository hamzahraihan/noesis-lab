/* ------------------------------------------------------------------ *
 * alarm-clock on uno: the raw-GPIO build.
 *
 * Mirrors `runs each LCD project live on the bench` (alarm branch: 120
 * frames, GPIO commons, colon blink, released buttons, silent buzzer,
 * advancing serial seconds, 12-frame alarm tap) and `moves the
 * alarm-clock digits over time and on button taps` (30 frames to 15:00,
 * 61 s jump plus 12 frames to 15:01, 12-frame Hour hold plus 22 frames to
 * 16/17:01, with the toggle last: arming parks the glass in the alarm-time
 * view, which would hide the clock-view minute/hour assertions behind it).
 * The colon blink reads through `glass().colon` (the live
 * solver bias) instead of the leg's Wokwi `colonValue` sampling.
 * ------------------------------------------------------------------ */

import { FIVE_GLYPH, ONE_GLYPH, ZERO_GLYPH } from '../probes';
import { verdict, sameGlass } from './shared';
import type { CheckDef } from './shared';

export const alarmRawChecks: CheckDef[] = [
  {
    name: 'multiplexes digits, blinks colon, rests released and silent',
    run: (sim) => {
      const started = performance.now();
      const name = 'multiplexes digits, blinks colon, rests released and silent';
      let digitSeenHigh = false;
      const colonSamples: boolean[] = [];
      for (let frame = 0; frame < 120; frame++) {
        sim.tick(0.05);
        for (const gpio of [2, 3, 4, 5]) {
          if (sim.readGpio(gpio)) digitSeenHigh = true;
        }
        if (frame % 20 === 19) colonSamples.push(sim.glass().colon);
      }
      if (!digitSeenHigh) return verdict(name, started, 'fail', 'no digit common went high');
      if (!colonSamples.includes(true) || !colonSamples.includes(false)) {
        return verdict(name, started, 'fail', 'colon never blinked');
      }
      if (!sim.readGpio(14) || !sim.readGpio(15) || !sim.readGpio(16)) {
        return verdict(name, started, 'fail', 'a button reads pressed while released');
      }
      if (sim.readGpio(17)) return verdict(name, started, 'fail', 'buzzer driven while disarmed');
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'idles at 15:00',
    run: (sim) => {
      const started = performance.now();
      const name = 'idles at 15:00';
      for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
      const glass = sim.glass();
      if (glass.text !== '1500') return verdict(name, started, 'fail', `glass reads ${glass.text}`);
      if (!sameGlass(glass.glyphs, [ONE_GLYPH, FIVE_GLYPH, ZERO_GLYPH, ZERO_GLYPH])) {
        return verdict(name, started, 'fail', 'a digit is not 1500');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'rtc ticks under the display',
    run: (sim) => {
      const started = performance.now();
      const name = 'rtc ticks under the display';
      // Order-dependent: relies on "idles at 15:00" (serial seconds accumulate over prior ticks).
      const seconds = [...sim.serialText().matchAll(/t=\d+:\d+:(\d+)/g)].map((match) =>
        Number(match[1]),
      );
      if (new Set(seconds).size <= 1) {
        return verdict(name, started, 'fail', 'serial seconds never advance');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'shows 15:01 a minute later',
    run: (sim) => {
      const started = performance.now();
      const name = 'shows 15:01 a minute later';
      sim.jumpTimeMs(61000);
      for (let frame = 0; frame < 12; frame++) sim.tick(0.05);
      const text = sim.glass().text;
      if (text !== '1501') return verdict(name, started, 'fail', `glass reads ${text}`);
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'hour tap moves the hour digits',
    run: (sim) => {
      const started = performance.now();
      const name = 'hour tap moves the hour digits';
      sim.pressButton(0, true);
      for (let frame = 0; frame < 12; frame++) sim.tick(0.05);
      sim.pressButton(0, false);
      for (let frame = 0; frame < 22; frame++) sim.tick(0.05);
      const text = sim.glass().text;
      if (!/^1[67]01$/.test(text)) return verdict(name, started, 'fail', `glass reads ${text}`);
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'alarm toggles on a short press',
    run: (sim) => {
      const started = performance.now();
      const name = 'alarm toggles on a short press';
      sim.pressButton(2, true);
      for (let frame = 0; frame < 12; frame++) sim.tick(0.05);
      sim.pressButton(2, false);
      for (let frame = 0; frame < 12; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('alarm toggled')) {
        return verdict(name, started, 'fail', 'no alarm toggled line');
      }
      return verdict(name, started, 'pass');
    },
  },
];
