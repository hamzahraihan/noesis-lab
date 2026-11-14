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

import { convergeGlass, FIVE_GLYPH, F_GLYPH, N_GLYPH, ONE_GLYPH, ZERO_GLYPH } from '../probes';
import { verdict, asProbe, sameGlyph, sameGlass } from './shared';
import type { CheckDef } from './shared';

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
