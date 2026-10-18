/**
 * Per-project check registry for the gallery smoke harness.
 *
 * Each entry pairs a gallery id × build with the scripted checks that prove
 * the build still runs, plus a factory that wraps a real `Simulation` into a
 * `CountingSim`. Check contents mirror the gallery legs in
 * `src/features/learn/gallery.test.ts` with identical tick counts and
 * margins; where a leg needs bench-deep access (`pushWokwiState` colon
 * sampling, the I2C bus log, LCD models, part knobs) the check asserts the
 * same behavior through the `HarnessSim` accessors instead, and the report
 * notes the substitution. The registry never touches the mounted bench,
 * editor state, or localStorage.
 */

import { Simulation } from '@/features/bench';
// Boundary-explicit: learn → simulation value edges are outside the gate's forbidden set (bench|instruments → learn, parts → simulation, shared → features); verified by `node scripts/check-boundaries.mjs`.
import {
  hexForSourcesHash,
  sourcesHashForProject,
  type FirmwareProject,
} from '@/features/simulation';
import { boardOption } from '../boardRegistry';
import { firmwareForBuild, GALLERY, type GalleryBuild } from '../gallery';
import {
  convergeGlass,
  FIVE_GLYPH,
  F_GLYPH,
  liveProbe,
  N_GLYPH,
  ONE_GLYPH,
  ZERO_GLYPH,
  type ProbeSim,
} from './probes';
import type { CheckDef, CheckResult, CheckStatus, CountingSim, HarnessSim } from './harness';

export interface RegistryEntry {
  readonly projectId: string;
  readonly buildLabel: string;
  readonly makeSim: () => CountingSim;
  readonly checks: CheckDef[];
  readonly extendedCapMs?: number;
}

/** Compile failures naming an unreachable backend record `skip`, not `fail`. */
const OFFLINE_RE = /offline|network|fetch failed|Tier-2.*unreachable/i;

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

/**
 * A real sim for one gallery build, wrapped into a `CountingSim` with the
 * harness adapter mapping: `tick` sums `d * 1000` into `simMs()`, `glass`
 * reads through `liveProbe`, buttons resolve by placement order, time jumps
 * move the engine clock, serial/GPIO read straight through, and the AVR
 * helpers expose the core, the siren-leg NVRAM staging, and the HEX-gated
 * worker compile.
 */
function makeSimFor(build: GalleryBuild, project: FirmwareProject): () => CountingSim {
  return () => {
    const board = boardOption(build.board).make();
    const sim = new Simulation(board);
    /*
     * The RP2040 engine lives in the simulation worker; this harness runs a
     * bench in-page. Running an rp2040 build on the interpreter here would be
     * the silently-wrong engine, so it refuses instead of pretending.
     */
    if (build.execution === 'rp2040') {
      throw new Error('rp2040 builds run in the simulation worker, not in-page');
    }
    sim.execution = build.execution ?? 'interpreter';
    sim.loadCircuit(build.circuit);
    sim.loadFirmware(project);
    sim.start();
    let total = 0;
    let tickCount = 0;
    return {
      tick: (wallDeltaSeconds: number) => {
        sim.tick(wallDeltaSeconds);
        total += wallDeltaSeconds * 1000;
        tickCount += 1;
      },
      simMs: () => total,
      ticks: () => tickCount,
      glass: () => liveProbe(sim).readGlass(),
      pressButton: (index: number, down: boolean) => {
        const target = sim.bench.parts.filter((p) => p.definition.name === 'Tactile Button')[index];
        if (target !== undefined) sim.setPressed(target.id, down);
      },
      jumpTimeMs: (ms: number) => {
        sim.engine.timeMs += ms;
      },
      serialText: () => sim.serialLines().join(''),
      readGpio: (gpio: number) => sim.engine.readDigital(gpio),
      resetAvrCore: () => {
        const core = (sim as unknown as { avrBackend: { reset(): void } | null }).avrBackend;
        if (core === null) return false;
        core.reset();
        return true;
      },
      stageArmedAlarm: () => {
        sim.engine.writeI2C(0x68, 0x08, true);
        sim.engine.writeI2C(0x68, 0x01, false);
      },
      tryCompile: async () => {
        if (hexForSourcesHash(sourcesHashForProject(project)) === null) {
          return { status: 'skip', detail: 'no committed HEX' };
        }
        try {
          await sim.compileAndRun(project);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          return OFFLINE_RE.test(detail) ? { status: 'skip', detail } : { status: 'fail', detail };
        }
        if (sim.compileState === 'ready') return { status: 'ready' };
        const detail =
          typeof sim.compileState === 'object' && sim.compileState !== null
            ? sim.compileState.error
            : `compileState ${String(sim.compileState)}`;
        return OFFLINE_RE.test(detail) ? { status: 'skip', detail } : { status: 'fail', detail };
      },
    };
  };
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

const alarmRawChecks: CheckDef[] = [
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

const alarmLibraryChecks: CheckDef[] = [
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

const safeChecks: CheckDef[] = [
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

const dashboardChecks: CheckDef[] = [
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

const parkingChecks: CheckDef[] = [
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

const weatherChecks: CheckDef[] = [
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

const reactionChecks: CheckDef[] = [
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

const netClockChecks: CheckDef[] = [
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

const sensorFeedChecks: CheckDef[] = [
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

function checksFor(projectId: string, build: GalleryBuild): CheckDef[] {
  if (projectId === 'alarm-clock') {
    return build.variant === 'library' ? alarmLibraryChecks : alarmRawChecks;
  }
  if (projectId === 'safe') return safeChecks;
  if (projectId === 'dashboard') return dashboardChecks;
  if (projectId === 'parking') return parkingChecks;
  if (projectId === 'weather') return weatherChecks;
  if (projectId === 'reaction') return reactionChecks;
  if (projectId === 'net-clock') return netClockChecks;
  if (projectId === 'sensor-feed') return sensorFeedChecks;
  return [];
}

export function buildRegistry(): RegistryEntry[] {
  return GALLERY.flatMap((entry) =>
    entry.builds.map((build) => {
      const project = firmwareForBuild(build, boardOption(build.board).language);
      return {
        projectId: entry.id,
        buildLabel: build.variant === undefined ? build.board : `${build.board}:${build.variant}`,
        makeSim: makeSimFor(build, project),
        checks: checksFor(entry.id, build),
        // The AVR worker compile measures ~150 s, over the 120 s runner default.
        extendedCapMs:
          entry.id === 'alarm-clock' && build.variant === 'library' ? 1_600_000 : undefined,
      };
    }),
  );
}
