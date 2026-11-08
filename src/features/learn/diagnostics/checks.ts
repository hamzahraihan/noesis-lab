/**
 * Per-project check definitions for the gallery smoke harness.
 *
 * Moved out of registry.ts so the generated checks-map can import them without
 * a circular dependency (registry.ts consumes the generated CHECKS_MAP).
 */

import { DS3231_TEMPERATURE_KNOB, BMP280_PRESSURE_KNOB, BMP280_TEMPERATURE_KNOB, LM35_TEMPERATURE_KNOB, MOISTURE_KNOB, VL53L0X_DISTANCE_KNOB, BME280_PRESSURE_KNOB, BME280_TEMPERATURE_KNOB, BME280_HUMIDITY_KNOB, SEGMENT_MAP } from '@/features/parts';
import {
  convergeGlass,
  FIVE_GLYPH,
  F_GLYPH,
  N_GLYPH,
  ONE_GLYPH,
  ZERO_GLYPH,
  type ProbeSim,
} from './probes';
import type { CheckDef, CheckResult, CheckStatus, HarnessSim } from './harness';
import type { GalleryBuild } from '../gallery';

function verdict(name: string, started: number, status: CheckStatus, detail = ''): CheckResult {
  return { name, status, detail, wallMs: performance.now() - started };
}

/** A `ProbeSim` over a check's sim, so the shared converge helper runs on it. */
function asProbe(sim: HarnessSim): ProbeSim {
  return {
    tick: (wallDeltaSeconds: number) => sim.tick(wallDeltaSeconds),
    readGlass: () => sim.glass(),
  };
}

function sameGlyph(actual: readonly number[] | undefined, expected: readonly number[]): boolean {
  return (
    actual !== undefined &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sameGlass(
  actual: readonly (readonly number[])[],
  expected: readonly (readonly number[])[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((glyph, index) => sameGlyph(glyph, expected[index]!))
  );
}

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

/* ------------------------------------------------------------------ *
 * alarm-clock on uno:library: the AVR build from the committed HEX.
 *
 * Mirrors `runs the alarm library build live (AVR)` (30 frames, 70-cap
 * converge to 15:00; 61 s jump, 45-frame pre-wait, 70-cap converge to
 * 15:01) and `…live status, NVRAM, and buzzer (AVR)` (8 frames armed, a
 * disarming tap plus 40-cap converge to the off view, a re-arming tap plus
 * 40-cap converge back to On, core reset plus 60-cap converge to the
 * persisted off view, staged armed save plus 10 frames, jump into the
 * 15:10 minute and a 25-frame siren watch). The siren block computes its
 * jump from the live glass and serial seconds so it lands inside the alarm
 * minute whatever the prior checks consumed. The colon blink reads
 * through `glass().colon` over the leg's 60 frames instead of Wokwi
 * sampling; the I2C save assertion is covered by the NVRAM round-trip
 * glass (the bus log has no `HarnessSim` accessor).
 * ------------------------------------------------------------------ */

export const alarmLibraryChecks: CheckDef[] = [
  {
    name: 'idles at 15:00',
    run: (sim) => {
      const started = performance.now();
      const name = 'idles at 15:00';
      for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
      const midnight = convergeGlass(asProbe(sim), 70);
      if (!midnight.converged) return verdict(name, started, 'fail', 'multiplex never settled');
      if (!sameGlass(midnight.glyphs, [ONE_GLYPH, FIVE_GLYPH, ZERO_GLYPH, ZERO_GLYPH])) {
        return verdict(name, started, 'fail', 'glass is not 15:00');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'buzzer silent while armed but not due',
    run: (sim) => {
      const started = performance.now();
      const name = 'buzzer silent while armed but not due';
      for (let frame = 0; frame < 8; frame++) sim.tick(0.05);
      if (sim.readGpio(17))
        return verdict(name, started, 'fail', 'buzzer driven while armed but not due');
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'alarm tap shows the status view',
    run: (sim) => {
      const started = performance.now();
      const name = 'alarm tap shows the status view';
      sim.pressButton(2, true);
      for (let frame = 0; frame < 20; frame++) sim.tick(0.01);
      const status = convergeGlass(asProbe(sim), 40);
      if (!status.converged) return verdict(name, started, 'fail', 'status view never settled');
      if (!sameGlyph(status.glyphs[1], ZERO_GLYPH) || !sameGlyph(status.glyphs[2], F_GLYPH)) {
        return verdict(name, started, 'fail', 'status view is not Off');
      }
      // Tap again to re-arm: the reset check below boots armed only if the
      // saved state is armed, which is what gives its proof power.
      sim.pressButton(2, false);
      for (let frame = 0; frame < 8; frame++) sim.tick(0.05);
      sim.pressButton(2, true);
      for (let frame = 0; frame < 20; frame++) sim.tick(0.01);
      const rearmed = convergeGlass(asProbe(sim), 40);
      if (!rearmed.converged) return verdict(name, started, 'fail', 're-arm status never settled');
      if (!sameGlyph(rearmed.glyphs[1], ZERO_GLYPH) || !sameGlyph(rearmed.glyphs[2], N_GLYPH)) {
        return verdict(name, started, 'fail', 're-arm status is not On');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'nvram persists the arm across reset',
    run: (sim) => {
      const started = performance.now();
      const name = 'nvram persists the arm across reset';
      if (sim.resetAvrCore?.() !== true)
        return verdict(name, started, 'skip', 'no avr core flashed');
      for (let frame = 0; frame < 8; frame++) sim.tick(0.05);
      const rearmed = convergeGlass(asProbe(sim), 60);
      if (!rearmed.converged) {
        return verdict(name, started, 'fail', 'second status view never settled');
      }
      if (
        !sameGlyph(rearmed.glyphs[1], ZERO_GLYPH) ||
        !sameGlyph(rearmed.glyphs[2], F_GLYPH) ||
        !sameGlyph(rearmed.glyphs[3], F_GLYPH)
      ) {
        return verdict(name, started, 'fail', 'reboot did not come back armed');
      }
      sim.pressButton(2, false);
      for (let frame = 0; frame < 8; frame++) sim.tick(0.05);
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'buzzer rings while the alarm is due',
    run: (sim) => {
      const started = performance.now();
      const name = 'buzzer rings while the alarm is due';
      sim.stageArmedAlarm?.();
      if (sim.resetAvrCore?.() !== true)
        return verdict(name, started, 'skip', 'no avr core flashed');
      for (let frame = 0; frame < 10; frame++) sim.tick(0.05);
      // Land inside the 15:10 alarm minute from wherever prior checks left
      // the clock, reading the same live glass and serial seconds the legs
      // assert rather than assuming a fixed offset.
      const shownMin = Number(sim.glass().text.slice(2));
      const serials = [...sim.serialText().matchAll(/t=\d+:(\d+):(\d+)/g)];
      const lastSerial = serials[serials.length - 1];
      const serialSec = lastSerial !== undefined ? Number(lastSerial[2]) : 0;
      if (!(shownMin >= 0 && shownMin <= 10)) {
        return verdict(name, started, 'fail', 'clock left the alarm hour');
      }
      if (shownMin !== 10) {
        sim.jumpTimeMs(((10 - shownMin) * 60 + (5 - serialSec)) * 1000);
        for (let frame = 0; frame < 20; frame++) sim.tick(0.05);
      }
      let buzzerSeenHigh = false;
      for (let frame = 0; frame < 25; frame++) {
        sim.tick(0.05);
        if (sim.readGpio(17)) buzzerSeenHigh = true;
      }
      if (!buzzerSeenHigh) return verdict(name, started, 'fail', 'buzzer never drove high');
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'shows 15:11 a minute after the siren minute',
    run: (sim) => {
      const started = performance.now();
      const name = 'shows 15:11 a minute after the siren minute';
      sim.jumpTimeMs(61000);
      for (let frame = 0; frame < 45; frame++) sim.tick(0.05);
      const minute = convergeGlass(asProbe(sim), 70);
      if (!minute.converged) return verdict(name, started, 'fail', 'multiplex never settled');
      if (!sameGlass(minute.glyphs, [ONE_GLYPH, FIVE_GLYPH, ONE_GLYPH, ONE_GLYPH])) {
        return verdict(name, started, 'fail', 'glass is not 15:11');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'colon blinks',
    run: (sim) => {
      const started = performance.now();
      const name = 'colon blinks';
      const samples: boolean[] = [];
      for (let frame = 0; frame < 60; frame++) {
        sim.tick(0.05);
        if (frame % 20 === 19) samples.push(sim.glass().colon);
      }
      if (!samples.includes(true) || !samples.includes(false)) {
        return verdict(name, started, 'fail', 'colon never blinked');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'worker compile lands ready',
    run: async (sim) => {
      const started = performance.now();
      const name = 'worker compile lands ready';
      const outcome = await sim.tryCompile?.();
      if (outcome === undefined) return verdict(name, started, 'skip', 'no compile support');
      if (outcome.status === 'ready') return verdict(name, started, 'pass');
      return verdict(name, started, outcome.status, outcome.detail);
    },
  },
];

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

function pressAndSettle(sim: HarnessSim, index: number): void {
  sim.pressButton(index, true);
  for (let frame = 0; frame < 4; frame++) sim.tick(0.05);
  sim.pressButton(index, false);
  for (let frame = 0; frame < 4; frame++) sim.tick(0.05);
}

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

/* ------------------------------------------------------------------ *
 * dashboard on uno: the knob parks mid-travel, the horn follows.
 *
 * The `sweeps the dashboard horn` leg holds title assertions only, so
 * these checks follow the sketch at its default wiper: 10 frames carry
 * two 200 ms loop passes reporting `knob 511 horn 90`, and the mid-third
 * pin (D7) drives high while D6/D8 rest low. Pin levels, not brightness:
 * the LED bar has no `HarnessSim` accessor. Verified live.
 * ------------------------------------------------------------------ */

export const dashboardChecks: CheckDef[] = [
  {
    name: 'reports knob and horn on serial',
    run: (sim) => {
      const started = performance.now();
      const name = 'reports knob and horn on serial';
      for (let frame = 0; frame < 10; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('knob 511 horn 90')) {
        return verdict(name, started, 'fail', 'no knob/horn line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'mid third selects the middle indicator',
    run: (sim) => {
      const started = performance.now();
      const name = 'mid third selects the middle indicator';
      // Order-dependent: relies on "reports knob and horn on serial" (its 10 frames ran the knob loop).
      if (sim.readGpio(6) !== false || sim.readGpio(7) !== true || sim.readGpio(8) !== false) {
        return verdict(name, started, 'fail', 'third pins mis-selected');
      }
      return verdict(name, started, 'pass');
    },
  },
];

/* ------------------------------------------------------------------ *
 * parking on uno: the default echo reads 100 cm, the far band holds.
 *
 * The `beeps at the parking sensor` leg holds title assertions only, so
 * these checks follow the sketch at its default knob: 10 frames carry
 * two ~240 ms loop passes reporting `cm 100`, D10 drives high (echo
 * present) while the sub-100 and sub-30 bands and the D9 buzzer rest
 * low. Pin levels, not brightness. Verified live.
 * ------------------------------------------------------------------ */

export const parkingChecks: CheckDef[] = [
  {
    name: 'reports centimetres on serial',
    run: (sim) => {
      const started = performance.now();
      const name = 'reports centimetres on serial';
      for (let frame = 0; frame < 10; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('cm 100')) {
        return verdict(name, started, 'fail', 'no centimetre line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'far echo holds the band pins',
    run: (sim) => {
      const started = performance.now();
      const name = 'far echo holds the band pins';
      // Order-dependent: relies on "reports centimetres on serial" (its 10 frames ran the echo loop).
      if (
        sim.readGpio(10) !== true ||
        sim.readGpio(11) !== false ||
        sim.readGpio(12) !== false ||
        sim.readGpio(9) !== false
      ) {
        return verdict(name, started, 'fail', 'band pins mis-held');
      }
      return verdict(name, started, 'pass');
    },
  },
];

/* ------------------------------------------------------------------ *
 * weather on uno: one serial line per 2 s reading.
 *
 * The `logs the weather station` leg holds title assertions only, and
 * the LCD model has no `HarnessSim` accessor, so these checks read the
 * serial mirror over the LCD leg's 120 frames: three readings of
 * `t 25 C rh 50 %` at the default knobs. Verified live.
 * ------------------------------------------------------------------ */

export const weatherChecks: CheckDef[] = [
  {
    name: 'logs temperature on serial',
    run: (sim) => {
      const started = performance.now();
      const name = 'logs temperature on serial';
      for (let frame = 0; frame < 120; frame++) sim.tick(0.05);
      if (!sim.serialText().includes('t 25 C')) {
        return verdict(name, started, 'fail', 'no temperature line');
      }
      return verdict(name, started, 'pass');
    },
  },
  {
    name: 'logs humidity on serial',
    run: (sim) => {
      const started = performance.now();
      const name = 'logs humidity on serial';
      // Order-dependent: relies on "logs temperature on serial" (its 120 frames produced the readings).
      if (!sim.serialText().includes('rh 50 %')) {
        return verdict(name, started, 'fail', 'no humidity line');
      }
      return verdict(name, started, 'pass');
    },
  },
];

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

/* ------------------------------------------------------------------ *
 * net-clock on esp32: join the bench network, ask it the time, repeat.
 *
 * The only project whose data does not come from the board, so its checks
 * follow the serial: the join prints the address the network handed out, and
 * the loop prints the bench clock once per second -- which is also proof that
 * it kept asking rather than reading once.
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * sensor-feed on esp32: subscribe, then receive once a second.
 *
 * The receive loop is the point, so the checks follow the serial: the
 * subscription is accepted, readings arrive, and the second one is a *later*
 * reading rather than the retained first one repeated.
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * net-weather on esp32: two bench hosts, one radio, one request at a time.
 *
 * The rotation is the check: the serial has to carry the clock from
 * `ntp.noesis` and both readings from `sensor.noesis`, which can only happen
 * if the loop resets and moves on after each answer.
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * live-weather on esp32: the one project that asks a real host.
 *
 * The harness is offline by design -- `makeSimFor` builds a bench with no live
 * bridge -- so these checks pin the half that is this repository's to pin: the
 * join, the request going out, and a host that cannot answer being *reported*
 * rather than waited on. What open-meteo returns is somebody else's business,
 * and a check that needed it would fail whenever the internet does.
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * soil-probe on uno: the behaviour-part worked example.
 *
 * The part is not in the catalogue: its definition travels inside the
 * circuit document, and its behaviour is a script the bench runs. Mirrors
 * `runs the scripted probe live: the knob is the sensor` (the runtime
 * awaited, 1.5 s of ticks, the knob's default fraction on the serial) --
 * the knob turn itself stays in the gallery leg, which has the bench.
 * ------------------------------------------------------------------ */

export const soilProbeChecks: CheckDef[] = [
  {
    name: 'reads the scripted probe on A0',
    run: async (sim) => {
      const started = performance.now();
      const name = 'reads the scripted probe on A0';
      await sim.scriptedReady?.();
      for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
      const match = /moisture (\d+)%/.exec(sim.serialText());
      if (match === null) return verdict(name, started, 'fail', 'no moisture line on the serial');
      const percent = Number(match[1]);
      // The definition's knob default is 40, and the ADC reads the divider.
      if (percent < 30 || percent > 50) {
        return verdict(name, started, 'fail', `moisture ${percent}% at the knob default`);
      }
      return verdict(name, started, 'pass', `moisture ${percent}%`);
    },
  },
];

/* ------------------------------------------------------------------ *
 * instrument-bench on uno: three bus instruments on one pair of wires.
 *
 * Mirrors `runs the instrument bench live: three instruments on one bus` --
 * the sketch reads for a second before its first line, so the bench is run
 * for longer than that, and the numbers it prints are the ones the operator
 * dialled in.
 * ------------------------------------------------------------------ */

export const instrumentBenchChecks: CheckDef[] = [
  {
    name: 'reads the barometer, the monitor and the converter',
    run: (sim) => {
      const started = performance.now();
      const name = 'reads the barometer, the monitor and the converter';
      for (let frame = 0; frame < 60; frame++) sim.tick(0.05);
      const text = sim.serialText();
      // The barometer's own counts, compensated in the sketch.
      if (!text.includes('barometer 1013 hPa')) {
        return verdict(name, started, 'fail', 'no barometer line on the serial');
      }
      if (!text.includes('temperature 20.0 C')) {
        return verdict(name, started, 'fail', 'no temperature on the serial');
      }
      // The monitor's registers, read over the bus.
      if (!text.includes('monitor 100 mA')) {
        return verdict(name, started, 'fail', 'no current on the serial');
      }
      if (!text.includes('power 500 mW')) {
        return verdict(name, started, 'fail', 'no power on the serial');
      }
      // The converter, pointed at channel zero.
      if (!text.includes('converter 0 counts')) {
        return verdict(name, started, 'fail', 'no converter counts on the serial');
      }
      return verdict(name, started, 'pass');
    },
  },
];

/* ------------------------------------------------------------------ *
 * environment-bench on uno: three sensors on one pair of wires.
 *
 * Mirrors `runs the environment bench live: three sensors on one bus` --
 * the light count, the thermometer's signed word and the humidity sensor's
 * two CRC-protected words all have to read back at their knob defaults.
 * ------------------------------------------------------------------ */

export const environmentBenchChecks: CheckDef[] = [
  {
    name: 'reads the light, the thermometer and the humidity sensor',
    run: (sim) => {
      const started = performance.now();
      const name = 'reads the light, the thermometer and the humidity sensor';
      for (let frame = 0; frame < 60; frame++) sim.tick(0.05);
      const text = sim.serialText();
      if (!text.includes('light 250 lx')) {
        return verdict(name, started, 'fail', 'no light reading on the serial');
      }
      if (!text.includes('tmp102 21.00 C')) {
        return verdict(name, started, 'fail', 'no TMP102 reading on the serial');
      }
      if (!text.includes('sht31 21.00 C')) {
        return verdict(name, started, 'fail', 'no SHT31 temperature on the serial');
      }
      if (!text.includes('humidity 45.0 %')) {
        return verdict(name, started, 'fail', 'no humidity reading on the serial');
      }
      // The sketch checks both CRCs itself; a frame the bench got wrong would
      // print "crc bad" rather than a reading.
      if (!text.includes('crc ok')) {
        return verdict(name, started, 'fail', 'the SHT31 frame failed its CRC');
      }
      return verdict(name, started, 'pass');
    },
  },
];

/* ------------------------------------------------------------------ *
 * shift-register on uno: a byte goes in over SPI and the outputs follow.
 *
 * The chase moves one LED per step, so the row is watched over a whole
 * cycle: every output has to be driven at some point, and only one at a
 * time, because the chip holds one byte and not eight.
 * ------------------------------------------------------------------ */

export function shiftRegisterChecks(build: GalleryBuild): CheckDef[] {
  const register = build.circuit.parts?.find((part) => part.type === 'shift595')?.id;
  return [
    {
      name: 'the byte shifts in and the outputs follow it',
      run: (sim) => {
        const started = performance.now();
        const name = 'the byte shifts in and the outputs follow it';
        const read = sim.partVolts;
        if (read === undefined || register === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a part pin');
        }
        const lit = new Set<string>();
        let together = 0;
        for (let frame = 0; frame < 40; frame++) {
          sim.tick(0.05);
          let on = 0;
          for (let index = 0; index < 8; index++) {
            if (read(register, `Q${index}`) > 1) {
              lit.add(`Q${index}`);
              on += 1;
            }
          }
          if (on > 1) together = on;
        }
        if (lit.size === 0) {
          return verdict(name, started, 'fail', 'no output was ever driven');
        }
        if (lit.size < 8) {
          return verdict(
            name,
            started,
            'fail',
            `only ${lit.size} of the eight outputs were driven`,
          );
        }
        if (together > 1) {
          return verdict(name, started, 'fail', `${together} outputs were driven at once`);
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * max7219 on uno: a heart is written register by register, and the glass
 * shows what the registers hold.
 *
 * The beat alternates a wide frame and a narrow one, so the left and right
 * columns have to be lit at some point and dark at another -- which is the
 * whole claim: the frame the sketch writes is the frame the glass shows.
 * ------------------------------------------------------------------ */

export function max7219Checks(build: GalleryBuild): CheckDef[] {
  const matrix = build.circuit.parts?.find((part) => part.type === 'max7219-matrix')?.id;
  return [
    {
      name: 'the heart the sketch writes appears on the glass',
      run: (sim) => {
        const started = performance.now();
        const name = 'the heart the sketch writes appears on the glass';
        const read = sim.matrix;
        if (read === undefined || matrix === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a matrix');
        }
        let woke = false;
        let middleLit = false;
        let edgeLit = false;
        let edgeDark = false;
        for (let frame = 0; frame < 80; frame++) {
          sim.tick(0.05);
          const glass = read(matrix);
          if (glass === undefined) continue;
          if (glass.lit) woke = true;
          // Column 3 is the heart's middle: lit from the top row down.
          if (glass.isLit(2, 1)) middleLit = true;
          if (glass.isLit(0, 1)) edgeLit = true;
          else edgeDark = true;
        }
        if (!woke) {
          return verdict(name, started, 'fail', 'the chip was never taken out of shutdown');
        }
        if (!middleLit) {
          return verdict(name, started, 'fail', 'no column was ever written');
        }
        if (!edgeLit || !edgeDark) {
          return verdict(name, started, 'fail', 'the frame never changed: the beat never showed');
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * nokia-5110 on uno: a sine wave drawn on 84x48 pixels of glass.
 *
 * The panel keeps the picture in its own memory, so the claim is that the
 * bytes the sketch writes are the pixels the glass shows -- and that the
 * wave moves, which is what the phase is for. The signature pairs the
 * number of lit pixels in the middle band with the row the centre column
 * is lit on: a still wave has one of them, a travelling one has many.
 * ------------------------------------------------------------------ */

export function nokia5110Checks(build: GalleryBuild): CheckDef[] {
  const panel = build.circuit.parts?.find((part) => part.type === 'nokia-5110')?.id;
  return [
    {
      name: 'the wave the sketch writes appears on the glass and moves',
      run: (sim) => {
        const started = performance.now();
        const name = 'the wave the sketch writes appears on the glass and moves';
        const read = sim.panel;
        if (read === undefined || panel === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a panel');
        }
        let woke = false;
        let middleLit = false;
        const signatures = new Set<string>();
        for (let frame = 0; frame < 80; frame++) {
          sim.tick(0.05);
          const glass = read(panel);
          if (glass === undefined) continue;
          if (glass.lit) woke = true;
          // The middle band of the glass: the rows the wave passes through.
          let bandCount = 0;
          for (let x = 0; x < 84; x++) {
            for (let y = 16; y < 32; y++) {
              if (glass.isLit(x, y)) bandCount++;
            }
          }
          if (bandCount > 0) middleLit = true;
          // The centre column's lit row, which is where the wave is at that
          // moment. A wave that stands still has one row for ever.
          let centreRow = -1;
          for (let y = 0; y < 48; y++) {
            if (glass.isLit(42, y)) {
              centreRow = y;
              break;
            }
          }
          // Only a frame that caught the wave on the glass counts: a frame
          // that caught the panel half-cleared would otherwise add a
          // signature of its own.
          if (centreRow >= 0) signatures.add(`${bandCount}:${centreRow}`);
        }
        if (!woke) {
          return verdict(name, started, 'fail', 'the glass never came on');
        }
        if (!middleLit) {
          return verdict(name, started, 'fail', 'no pixel in the middle band was ever lit');
        }
        if (signatures.size < 2) {
          return verdict(name, started, 'fail', 'the wave never moved');
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * rfid on uno: the chip answers on the bus, and the card changes what it
 * answers.
 *
 * The reader has no glass and drives no pin the bench can read: everything
 * it says goes out on MISO and comes back through the sketch's serial
 * output. So the check watches the log, in the order a reader meets the
 * chip's states -- version, an empty field, a card, an empty field again.
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * tm1637 on uno: a number the sketch counts lands on the glass.
 *
 * The display's digits are the module's own registers, so the check reads
 * them where they live and compares them with the number the sketch
 * reported: the glass and the log have to agree.
 * ------------------------------------------------------------------ */

export function tm1637Checks(build: GalleryBuild): CheckDef[] {
  const module = build.circuit.parts?.find((part) => part.type === 'tm1637')?.id;
  return [
    {
      name: 'the display counts the seconds on its glass',
      run: (sim) => {
        const started = performance.now();
        const name = 'the display counts the seconds on its glass';
        const read = sim.tm1637;
        if (read === undefined || module === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a display module');
        }
        const display = read(module);
        if (display === undefined) {
          return verdict(name, started, 'skip', 'the bench has no display module');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        if (!display.lit) {
          return verdict(name, started, 'fail', 'the glass is not lit');
        }
        const reported = /t\+(\d+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a time');
        }
        const seconds = Number(reported[1]);
        const expected = SEGMENT_MAP[String(seconds % 10)] ?? 0;
        if ((display.digits[3] ?? 0) !== expected) {
          return verdict(
            name,
            started,
            'fail',
            `the glass shows ${display.digits[3]}, not the ${expected} of ${seconds}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * a4988 on uno: a pulse moves the motor, and the shaft agrees with the
 * count the sketch reported.
 *
 * The driver does the phase sequence, so the check does not look at the
 * windings: it looks at where the shaft ended up, which is the thing the
 * sketch asked for.
 * ------------------------------------------------------------------ */

export function a4988Checks(build: GalleryBuild): CheckDef[] {
  const motor = build.circuit.parts?.find((part) => part.type === 'stepper-motor')?.id;
  const supply = build.circuit.parts?.find((part) => part.type === 'power-supply')?.id;
  return [
    {
      name: 'the driver turns the motor one step per pulse',
      run: (sim) => {
        const started = performance.now();
        const name = 'the driver turns the motor one step per pulse';
        const angle = sim.stepperAngle;
        if (angle === undefined || motor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a motor');
        }
        let peak = 0;
        for (let frame = 0; frame < 60; frame++) {
          sim.tick(0.05);
          peak = Math.max(peak, angle(motor));
        }
        if (peak === 0) {
          return verdict(name, started, 'fail', 'the motor never moved');
        }
        // The log says how many steps the shaft is net of; it has turned
        // that many times seven and a half degrees.
        const reported = /step (-?\d+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a step');
        }
        const expected = Number(reported[1]) * 7.5;
        if (Math.abs(angle(motor) - expected) > 15) {
          return verdict(
            name,
            started,
            'fail',
            `the shaft stands at ${angle(motor)} degrees, not the ${expected} of ${reported[1]} steps`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
    {
      name: 'the motor runs on the supply, not on the board',
      run: (sim) => {
        const started = performance.now();
        const name = 'the motor runs on the supply, not on the board';
        const read = sim.partVolts;
        const knob = sim.knob;
        if (
          read === undefined ||
          knob === undefined ||
          motor === undefined ||
          supply === undefined
        ) {
          return verdict(name, started, 'skip', 'the bench cannot read the windings');
        }
        // The windings are driven in one direction at a time, so the reading
        // is a peak rather than a value.
        let peak = 0;
        for (let frame = 0; frame < 30; frame++) {
          sim.tick(0.05);
          peak = Math.max(peak, Math.abs(read(motor, 'A+') - read(motor, 'A-')));
        }
        const volts = knob(supply, 'volts');
        if (Math.abs(peak - volts) > 0.5) {
          return verdict(
            name,
            started,
            'fail',
            `the windings saw ${peak} volts and the supply is at ${volts}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * microstep on uno: sixteen pulses are one full step, and the winding
 * spends part of the cycle between the rails.
 *
 * The driver's translator still does the phase sequence; what changes is
 * the resolution and the average the bridge presents to the winding.
 * ------------------------------------------------------------------ */

export function microstepChecks(build: GalleryBuild): CheckDef[] {
  const motor = build.circuit.parts?.find((part) => part.type === 'stepper-motor')?.id;
  const supply = build.circuit.parts?.find((part) => part.type === 'power-supply')?.id;
  return [
    {
      name: 'sixteen microsteps turn the motor one full step',
      run: (sim) => {
        const started = performance.now();
        const name = 'sixteen microsteps turn the motor one full step';
        const angle = sim.stepperAngle;
        if (angle === undefined || motor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a motor');
        }
        let peak = 0;
        let reported = false;
        for (let frame = 0; frame < 200; frame++) {
          sim.tick(0.05);
          peak = Math.max(peak, angle(motor));
          if (sim.serialText().includes('microstep 16')) {
            reported = true;
            break;
          }
        }
        if (!reported) {
          return verdict(name, started, 'fail', 'the sketch did not report the forward sixteen');
        }
        if (Math.abs(peak - 7.5) > 0.6) {
          return verdict(
            name,
            started,
            'fail',
            `the shaft peaked at ${peak} degrees, not the 7.5 of one full step`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
    {
      name: 'a microstep drives the winding below the supply',
      run: (sim) => {
        const started = performance.now();
        const name = 'a microstep drives the winding below the supply';
        const read = sim.partVolts;
        const knob = sim.knob;
        if (
          read === undefined ||
          knob === undefined ||
          motor === undefined ||
          supply === undefined
        ) {
          return verdict(name, started, 'skip', 'the bench cannot read the windings');
        }
        const volts = knob(supply, 'volts');
        let fractional = false;
        for (let frame = 0; frame < 200; frame++) {
          sim.tick(0.05);
          const across = Math.abs(read(motor, 'A+') - read(motor, 'A-'));
          if (across > volts * 0.1 && across < volts * 0.9) {
            fractional = true;
            break;
          }
        }
        if (!fractional) {
          return verdict(name, started, 'fail', 'the winding stayed at a rail, not between them');
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * pcf8574 on uno: one byte, and eight lights that agree with it.
 *
 * The expander is the answer to a board that has run out of pins, so what
 * matters is that the byte the sketch wrote is the byte the lights show.
 * ------------------------------------------------------------------ */

export function pcf8574Checks(build: GalleryBuild): CheckDef[] {
  const leds =
    build.circuit.parts?.filter((part) => part.type === 'led-red').map((part) => part.id) ?? [];
  return [
    {
      name: 'the eight lights show the count the log reports',
      run: (sim) => {
        const started = performance.now();
        const name = 'the eight lights show the count the log reports';
        const read = sim.partVolts;
        if (read === undefined || leds.length === 0) {
          return verdict(name, started, 'skip', 'the bench cannot read the lights');
        }
        for (let frame = 0; frame < 60; frame++) {
          sim.tick(0.05);
        }
        const reported = /count (\d+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a count');
        }
        const value = Number(reported[1]);
        let wrong = 0;
        for (let bit = 0; bit < leds.length; bit++) {
          const isLit = read(leds[bit]!, 'A') > 1;
          const shouldBeLit = ((value >> bit) & 1) === 1;
          if (isLit !== shouldBeLit) wrong += 1;
        }
        if (wrong > 0) {
          return verdict(
            name,
            started,
            'fail',
            `${wrong} of the ${leds.length} lights did not match the count`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * mcp23017 on uno: sixteen pins, one sixteen-bit number.
 *
 * The expander's latches are its own state, so the check watches the lights
 * the two ports drive and compares them with the last number the sketch
 * printed -- sixteen bits, low byte on port A and high byte on port B.
 * ------------------------------------------------------------------ */

export function mcp23017Checks(build: GalleryBuild): CheckDef[] {
  const leds =
    build.circuit.parts?.filter((part) => part.type === 'led-red').map((part) => part.id) ?? [];
  return [
    {
      name: 'the sixteen lights show the count the log reports',
      run: (sim) => {
        const started = performance.now();
        const name = 'the sixteen lights show the count the log reports';
        const read = sim.partVolts;
        if (read === undefined || leds.length !== 16) {
          return verdict(name, started, 'skip', 'the bench cannot read the lights');
        }
        for (let frame = 0; frame < 60; frame++) sim.tick(0.05);
        const counts = [...sim.serialText().matchAll(/count (\d+)/g)].map((match) =>
          Number(match[1]),
        );
        if (counts.length === 0) {
          return verdict(name, started, 'fail', 'the sketch did not report a count');
        }
        const value = counts[counts.length - 1]!;
        let wrong = 0;
        for (let bit = 0; bit < leds.length; bit++) {
          const isLit = read(leds[bit]!, 'anode') > 1;
          const shouldBeLit = ((value >> bit) & 1) === 1;
          if (isLit !== shouldBeLit) wrong += 1;
        }
        if (wrong > 0) {
          return verdict(
            name,
            started,
            'fail',
            `${wrong} of the ${leds.length} lights did not match the count`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * expander-interrupt on uno: a button the expander watches by itself.
 *
 * The sketch never polls the bus; the chip samples PA0 and pulls INTA, and
 * the light is the sketch's answer to that pin. The checks watch the log for
 * the two lines the sketch prints from the interrupt path, and the light for
 * the level it sets there. The pull-up is switched on before the watch starts
 * precisely so setup is not reported as a press, which is the first check.
 * ------------------------------------------------------------------ */

export function expanderInterruptChecks(build: GalleryBuild): CheckDef[] {
  const leds =
    build.circuit.parts?.filter((part) => part.type === 'led-red').map((part) => part.id) ?? [];
  const lit = (sim: HarnessSim): boolean =>
    sim.partVolts !== undefined && leds.length === 1 && sim.partVolts(leds[0]!, 'anode') > 1;
  return [
    {
      name: 'setup starts the watch without reporting a press',
      run: (sim) => {
        const started = performance.now();
        const name = 'setup starts the watch without reporting a press';
        if (sim.partVolts === undefined || leds.length !== 1) {
          return verdict(name, started, 'skip', 'the bench cannot read the light');
        }
        for (let frame = 0; frame < 20; frame++) sim.tick(0.05);
        const text = sim.serialText();
        if (!text.includes('watching PA0')) {
          return verdict(name, started, 'fail', 'the sketch did not start the watch');
        }
        if (text.includes('pressed')) {
          return verdict(name, started, 'fail', 'the pull-up coming up was reported as a press');
        }
        if (lit(sim)) return verdict(name, started, 'fail', 'the light is on before any press');
        return verdict(name, started, 'pass');
      },
    },
    {
      name: 'a press wakes the sketch through INTA and the release puts the light out',
      run: (sim) => {
        const started = performance.now();
        const name = 'a press wakes the sketch through INTA and the release puts the light out';
        if (sim.partVolts === undefined || leds.length !== 1) {
          return verdict(name, started, 'skip', 'the bench cannot read the light');
        }
        sim.pressButton(0, true);
        for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
        if (!sim.serialText().includes('pressed')) {
          return verdict(name, started, 'fail', 'no pressed line: INTA did not wake the sketch');
        }
        if (!lit(sim)) return verdict(name, started, 'fail', 'the light stayed dark on the press');
        sim.pressButton(0, false);
        for (let frame = 0; frame < 40; frame++) sim.tick(0.05);
        if (!sim.serialText().includes('released')) {
          return verdict(name, started, 'fail', 'no released line: the second edge was missed');
        }
        if (lit(sim))
          return verdict(name, started, 'fail', 'the light stayed lit after the release');
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * pca9685 on uno: sixteen channels, sixteen duties.
 *
 * A PWM output is a switched resistor, not a level, so the check samples a
 * whole frame and counts how often each light is high. One sixteenth of a
 * 50 Hz frame is 1.25 ms, and 80 samples at 0.25 ms put five of them inside
 * the high part; the tolerance covers sampling on a count boundary.
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * ds3231 on uno: a clock that lost power is set, then trusted.
 *
 * The status flag is the chip's own register, so the check follows what the
 * sketch reports after it clears the flag: the time it wrote, the die
 * temperature it read back, and the light toggling with the seconds.
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * max6675 on uno: the reading comes back over the bus.
 *
 * The chip answers with sixteen bits, so the check compares what the sketch
 * read with the temperature the probe is at -- the quarter-degree step and
 * all.
 * ------------------------------------------------------------------ */

export function max6675Checks(build: GalleryBuild): CheckDef[] {
  const module = build.circuit.parts?.find((part) => part.type === 'max6675')?.id;
  return [
    {
      name: 'the reading comes back the way the probe is set',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading comes back the way the probe is set';
        const knob = sim.knob;
        if (knob === undefined || module === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /celsius ([\d.]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a reading');
        }
        const read = Number(reported[1]);
        const expected = knob(module, 'probe');
        if (Math.abs(read - expected) > 0.25) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${read} and the probe is at ${expected}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * lm35 on uno: the temperature the sketch reads is the knob's degrees.
 *
 * The sensor puts 10 mV per degree on Vout, the Uno's ADC maps five volts
 * across 1024 counts, and the sketch converts back. The sketch's reported
 * temperature has to agree with the knob within a degree.
 * ------------------------------------------------------------------ */

export function lm35Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'lm35')?.id;
  return [
    {
      name: 'the reading follows the temperature knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the temperature knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /temperature ([\d-]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a temperature');
        }
        const read = Number(reported[1]);
        const expected = knob(sensor, LM35_TEMPERATURE_KNOB.id);
        if (Math.abs(read - expected) > 1) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${read} and the knob is at ${expected}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * bmp280 on uno: the reading matches the pressure and temperature knobs.
 *
 * The chip answers with raw counts over I2C, and the sketch applies the
 * datasheet's compensation with calibration coefficients it read itself.
 * The check compares what the sketch reported with what the knobs say.
 * ------------------------------------------------------------------ */

export function bmp280Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'bmp280-barometer')?.id;
  return [
    {
      name: 'pressure and temperature follow the knobs',
      run: (sim) => {
        const started = performance.now();
        const name = 'pressure and temperature follow the knobs';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read sensor knobs');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const log = sim.serialText();
        const pressureMatch = /pressure ([\d.]+) hPa/.exec(log);
        const temperatureMatch = /temperature ([\d.-]+) C/.exec(log);
        if (pressureMatch === null || temperatureMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report pressure and temperature');
        }
        const pressure = Number(pressureMatch[1]);
        const temperature = Number(temperatureMatch[1]);
        const expectedPressure = knob(sensor, BMP280_PRESSURE_KNOB.id);
        const expectedTemperature = knob(sensor, BMP280_TEMPERATURE_KNOB.id);
        if (Math.abs(pressure - expectedPressure) > 1) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${pressure} hPa and the knob is at ${expectedPressure}`,
          );
        }
        if (Math.abs(temperature - expectedTemperature) > 1) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${temperature} C and the knob is at ${expectedTemperature}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * vl53l0x on uno: the distance matches the distance knob.
 *
 * The chip answers with raw millimetre counts over I2C. The check compares
 * what the sketch reported with what the knob says.
 * ------------------------------------------------------------------ */

export function vl53l0xChecks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'vl53l0x-distance')?.id;
  return [
    {
      name: 'the reading follows the distance knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the distance knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /distance ([\d]+) mm/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a distance');
        }
        const read = Number(reported[1]);
        const expected = knob(sensor, VL53L0X_DISTANCE_KNOB.id);
        if (Math.abs(read - expected) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${read} mm and the knob is at ${expected}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * bme280 on uno: the raw counts follow the knobs.
 *
 * The chip answers with raw counts over I2C. The check compares what the
 * sketch reported with what the knobs say.
 * ------------------------------------------------------------------ */

export function bme280Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'bme280-environment')?.id;
  return [
    {
      name: 'the raw counts follow the knobs',
      run: (sim) => {
        const started = performance.now();
        const name = 'the raw counts follow the knobs';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read sensor knobs');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const log = sim.serialText();
        const tempMatch = /raw temp ([\d]+)/.exec(log);
        const pressMatch = /raw press ([\d]+)/.exec(log);
        const humMatch = /raw hum ([\d]+)/.exec(log);
        if (tempMatch === null || pressMatch === null || humMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report raw counts');
        }
        const temp = Number(tempMatch[1]);
        const press = Number(pressMatch[1]);
        const hum = Number(humMatch[1]);
        const expectedTemp = knob(sensor, BME280_TEMPERATURE_KNOB.id);
        const expectedPress = knob(sensor, BME280_PRESSURE_KNOB.id);
        const expectedHum = knob(sensor, BME280_HUMIDITY_KNOB.id);
        if (Math.abs(temp - expectedTemp * 16) > 16) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read temp ${temp} and the knob is at ${expectedTemp}`,
          );
        }
        if (Math.abs(press - expectedPress * 16) > 16) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read pressure ${press} and the knob is at ${expectedPress}`,
          );
        }
        if (Math.abs(hum - expectedHum * 16) > 16) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read humidity ${hum} and the knob is at ${expectedHum}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * soil-moisture on uno: the reading follows the moisture knob.
 *
 * The sensor puts a fraction of the supply on AOUT, the Uno's ADC maps five
 * volts across 1024 counts, and the sketch converts back. The sketch's
 * reported moisture has to agree with the knob within a percent.
 * ------------------------------------------------------------------ */

export function soilMoistureChecks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'soil-moisture')?.id;
  return [
    {
      name: 'the reading follows the moisture knob',
      run: (sim) => {
        const started = performance.now();
        const name = 'the reading follows the moisture knob';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the sensor knob');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const reported = /moisture ([\d]+)/.exec(sim.serialText());
        if (reported === null) {
          return verdict(name, started, 'fail', 'the sketch did not report a moisture');
        }
        const read = Number(reported[1]);
        const expected = knob(sensor, MOISTURE_KNOB.id);
        if (Math.abs(read - expected) > 1) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ${read} % and the knob is at ${expected}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * mcp4725 on uno: the voltage the board reads is the voltage the sketch
 * wrote.
 *
 * The converter is the one part that makes a level rather than measuring
 * one, so the check reads it twice: the analog pin the board counts, and
 * the output itself.
 * ------------------------------------------------------------------ */

export function mcp4725Checks(build: GalleryBuild): CheckDef[] {
  const converter = build.circuit.parts?.find((part) => part.type === 'mcp4725')?.id;
  return [
    {
      name: 'the voltage the board reads is the voltage the sketch wrote',
      run: (sim) => {
        const started = performance.now();
        const name = 'the voltage the board reads is the voltage the sketch wrote';
        const read = sim.partVolts;
        if (read === undefined || converter === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the output');
        }
        let first = 0;
        let last = 0;
        for (let frame = 0; frame < 60; frame++) {
          sim.tick(0.05);
          const volts = read(converter, 'AOUT');
          if (frame === 0) first = volts;
          last = volts;
        }
        // The sketch walks the output up a ramp, so it has to have moved.
        if (Math.abs(last - first) < 0.2) {
          return verdict(name, started, 'fail', 'the output never moved');
        }
        // And the board has to have read the voltage the code asks for.
        const matches = [...sim.serialText().matchAll(/code (\d+) reads (\d+)/g)];
        if (matches.length === 0) {
          return verdict(name, started, 'fail', 'the sketch did not report a reading');
        }
        const reported = matches[matches.length - 1]!;
        const code = Number(reported[1]);
        const counts = Number(reported[2]);
        // The board counts in ten bits over the range the converter holds,
        // so the two numbers have to agree.
        const expected = (code / 4095) * 1023;
        if (Math.abs(counts - expected) > 24) {
          return verdict(
            name,
            started,
            'fail',
            `the board read ${counts} and the code was ${code}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * eeprom24lc256 on uno: the count lives in the memory, not in the sketch.
 *
 * A chip that forgot would start the count again, so a count that climbs
 * by one every time is the proof that the memory kept it.
 * ------------------------------------------------------------------ */

export function eepromChecks(): CheckDef[] {
  return [
    {
      name: 'the memory keeps the count the sketch wrote',
      run: (sim) => {
        const started = performance.now();
        const name = 'the memory keeps the count the sketch wrote';
        for (let frame = 0; frame < 60; frame++) sim.tick(0.05);
        const counts = [...sim.serialText().matchAll(/count (\d+)/g)].map((match) =>
          Number(match[1]),
        );
        if (counts.length < 2) {
          return verdict(name, started, 'fail', 'the sketch did not report a count');
        }
        for (let index = 1; index < counts.length; index++) {
          if (counts[index] !== counts[index - 1]! + 1) {
            return verdict(
              name,
              started,
              'fail',
              `the count went ${counts[index - 1]} to ${counts[index]}`,
            );
          }
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
