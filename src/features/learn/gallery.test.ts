import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PART_CATALOGUE, SevenSegment, breadboardDefinition } from '@/features/parts';
import { boardOption, type BoardId } from './boardRegistry';
import { GALLERY, boardsFor, buildFor, firmwareForBuild, galleryById } from './gallery';
import { TIER2_MANIFEST } from '@/features/simulation';
import { previewBench } from './exercise-preview-data';
import { Simulation } from '@/features/bench/simulations/simulation';
import { pushWokwiState } from '@/features/bench/wokwi/wokwi';
import type { FootprintState } from '@/features/bench/wokwi/footprints';

const CATALOGUE_NAMES = new Set(PART_CATALOGUE.map((entry) => entry.make().name));

function freshBench(board: BoardId) {
  const definition = boardOption(board).make();
  const simulation = new Simulation(definition);
  simulation.addPart(definition, 0, 0);
  simulation.addPart(breadboardDefinition(), 230, 0);
  return simulation;
}

function partTerminals(simulation: Simulation): Set<number> {
  const ids = new Set<number>();
  for (const part of simulation.bench.parts) {
    for (const id of Object.values(part.terminals)) ids.add(id);
  }
  return ids;
}

/**
 * Whether the committed alarm HEX is on disk. The avr parity legs run the
 * same assertions against the flashed HEX; where the HEX is absent (e.g. an
 * environment whose install never fetched the toolchain) they skip with a
 * reason instead of weakening any assertion.
 */
function hexAvailable(): boolean {
  return existsSync(join(__dirname, '..', 'simulation', 'avr', 'hex', 'alarm-clock-uno.hex'));
}

/**
 * Whether the Tier-2 fetch path answers at all. The declared build runs from
 * the committed HEX, but its declarations name fetched libraries, so parity
 * means nothing on a bench that could never fetch them. Any HTTP answer
 * counts as reachable; only a network failure or timeout skips.
 */
async function tier2Reachable(): Promise<boolean> {
  try {
    const response = await fetch(TIER2_MANIFEST[0].url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

/**
 * Expected 8-segment glyphs in SEGMENT_ORDER bit order, for the
 * accumulation probe below. '0'/'1' are the SevSeg numeral codes; 'n' is
 * SevSeg's 0x54 (C/E/G); 'F' is 0x71 (A/E/F/G). Lowercase 'o' renders as
 * 'O' — the same segments as '0' — per SevSeg's alpha table.
 */
const ZERO_GLYPH = [1, 1, 1, 1, 1, 1, 0, 0];
const ONE_GLYPH = [0, 1, 1, 0, 0, 0, 0, 0];
const N_GLYPH = [0, 0, 1, 0, 1, 0, 1, 0];
const F_GLYPH = [1, 0, 0, 0, 1, 1, 1, 0];

/**
 * Settles the lit segments per digit over up to `maxTicks` small frames.
 *
 * The library build multiplexes segments, not digits (SevSeg with resistors
 * on digits and no update delays: one segment pin at a time across every
 * digit that uses it), so the edge-latched glass never holds a whole
 * character at once. Unioning the instantaneous Wokwi values over full
 * multiplex cycles recovers the decoded content all the same — midnight
 * lights A-F on every digit, whatever any single instant says.
 *
 * The walk is live but its phase against the tick boundary jitters with
 * machine load, so the probe runs until the union stops changing (14 quiet
 * frames past a 30-frame floor) instead of asserting after a fixed count.
 * Digits whose code is blank never relatch and keep stale bits from the
 * previous view — callers assert only on digits the current view drives.
 */
function convergeGlass(
  simulation: Simulation,
  maxTicks: number,
): { glyphs: number[][]; converged: boolean } {
  const lit: number[][] = [0, 1, 2, 3].map(() => [0, 0, 0, 0, 0, 0, 0, 0]);
  let stable = 0;
  let converged = false;
  for (let frame = 0; frame < maxTicks; frame++) {
    simulation.tick(0.01);
    const seg = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
    const probe = {
      values: [] as number[],
      digits: 0,
      colon: false,
      colonValue: false,
    } as unknown as HTMLElement;
    pushWokwiState(probe, seg.definition, seg, {
      pinVolts: simulation.pinVoltages(),
      displays: simulation.displayControllers(),
    } as unknown as FootprintState);
    const values = (probe as unknown as { values: number[] }).values;
    let changed = false;
    for (let d = 0; d < 4; d++) {
      for (let s = 0; s < 8; s++) {
        if (values[d * 8 + s] === 1 && lit[d]![s] === 0) {
          lit[d]![s] = 1;
          changed = true;
        }
      }
    }
    stable = changed ? 0 : stable + 1;
    if (stable >= 14 && frame >= 30) {
      converged = true;
      break;
    }
  }
  return { glyphs: lit, converged };
}

describe('the project gallery', () => {
  it('numbers every project uniquely and builds each at least once', () => {
    const ids = GALLERY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of GALLERY) {
      expect(entry.builds.length, `${entry.id} builds`).toBeGreaterThan(0);
      expect(galleryById(entry.id)?.id).toBe(entry.id);
      for (const build of entry.builds) {
        expect(boardOption(build.board).id).toBe(build.board);
      }
    }
    expect(galleryById('nope')).toBeNull();
  });

  it('resolves builds per board and none where none exist', () => {
    for (const entry of GALLERY) {
      expect(boardsFor(entry)).toEqual([...new Set(entry.builds.map((build) => build.board))]);
      for (const board of boardsFor(entry)) {
        expect(buildFor(entry, board)?.board).toBe(board);
      }
      expect(buildFor(entry, 'mega')).toBeNull();
    }
    const alarm = galleryById('alarm-clock')!;
    expect(buildFor(alarm, 'uno')?.sketch).toBe(alarm.builds[0]!.sketch);
    expect(buildFor(alarm, 'uno', 'nope')).toBe(alarm.builds[0]!);
    // Unknown variant falls back to the default build (see plan Task 1 ruling).
    expect(buildFor(alarm, 'uno', 'library')).toBe(alarm.builds[1]!);
    // Both builds share one setup: guards against wiring drift between them.
    expect(alarm.builds[1]!.setup).toBe(alarm.builds[0]!.setup);
  });

  it('names only parts the catalogue stocks and says what running shows', () => {
    for (const entry of GALLERY) {
      for (const part of entry.parts) {
        expect(CATALOGUE_NAMES.has(part.name), `${entry.id} part "${part.name}"`).toBe(true);
        expect(part.qty).toBeGreaterThan(0);
      }
      expect(entry.working.length, `${entry.id} working`).toBeGreaterThan(0);
      expect(entry.blurb.length, `${entry.id} blurb`).toBeGreaterThan(0);
    }
  });

  it('parses every build sketch in its board language', () => {
    for (const entry of GALLERY) {
      for (const build of entry.builds) {
        const simulation = freshBench(build.board);
        simulation.loadFirmware(firmwareForBuild(build, boardOption(build.board).language));
        if (build.execution === 'avr') continue;
        expect(simulation.firmwareError, `${entry.id}/${build.board}: ${simulation.firmwareError}`).toBeNull();
      }
    }
    const lib = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    expect(lib.execution).toBe('avr');
    const libSim = freshBench('uno');
    libSim.loadFirmware(firmwareForBuild(lib, 'arduino-cpp'));
    // Still AVR-only, but the frontier moved: DateTime/TimeSpan, the
    // file-scope `enum`, and the Clock bodies now parse, so the interpreter
    // rejects the next unsupported shape instead (the deduced-size
    // `byte digitPins[]` wiring table in main.ino — Task 5's red, alongside
    // SevSeg and tone). Either rejection proves the build cannot run on the
    // interpreter yet.
    expect(libSim.firmwareError ?? '').toMatch(/expected a type|not found|expected ';'|expected number/);
  });

  it('wires every build onto its board bench without throwing', () => {
    const wireFloors: Record<string, number> = {
      'alarm-clock': 25,
      safe: 14,
      dashboard: 14,
      parking: 15,
      weather: 12,
      reaction: 5,
    };
    for (const entry of GALLERY) {
      for (const build of entry.builds) {
        const key = `${entry.id}/${build.board}`;
        const simulation = freshBench(build.board);
        expect(() => build.setup(simulation), `${key} setup`).not.toThrow();
        expect(simulation.bench.wires.length, `${key} wires`).toBeGreaterThanOrEqual(
          wireFloors[entry.id] ?? 1,
        );
        const real = partTerminals(simulation);
        const touched = new Set<number>();
        for (const wire of simulation.bench.wires) {
          expect(real.has(wire.from), `${key} wire from`).toBe(true);
          expect(real.has(wire.to), `${key} wire to`).toBe(true);
          touched.add(wire.from);
          touched.add(wire.to);
        }
        for (const part of entry.parts) {
          const placed = simulation.bench.parts.filter((p) => p.definition.name === part.name).length;
          expect(placed, `${key} "${part.name}" qty`).toBeGreaterThanOrEqual(part.qty);
        }
        for (const part of simulation.bench.parts) {
          const kind = part.definition.component.kind;
          if (kind === 'mcu' || kind === 'breadboard') continue;
          const wired = Object.values(part.terminals).some((id) => touched.has(id));
          expect(wired, `${key} "${part.definition.name}" wired`).toBe(true);
        }
      }
    }
  });

  it('frames every project preview on real content', () => {
    for (const entry of GALLERY) {
      for (const build of entry.builds) {
        const preview = previewBench(build.board, build.setup, `gallery:${build.board}:${entry.id}`);
        expect(preview.parts.length, `${entry.id} parts`).toBeGreaterThan(0);
        expect(preview.paths.length, `${entry.id} paths`).toBeGreaterThan(0);
      }
    }
  });

  it('opens with the alarm clock', () => {
    expect(galleryById('alarm-clock')?.title).toBe('Alarm Clock with RTC');
  });

  it('locks digits behind the safe', () => {
    expect(galleryById('safe')?.title).toBe('Electronic Safe');
  });

  it('sweeps the dashboard horn', () => {
    expect(galleryById('dashboard')?.title).toBe('Servo Dashboard');
  });

  it('beeps at the parking sensor', () => {
    expect(galleryById('parking')?.title).toBe('Parking Sensor');
  });

  it('logs the weather station', () => {
    expect(galleryById('weather')?.title).toBe('Weather Station');
  });

  it('times the reaction game', () => {
    expect(galleryById('reaction')?.title).toBe('Reaction Timer');
  });

  it('declares SevSeg and RTClib on the alarm build, unpinned', () => {
    const build = galleryById('alarm-clock')!.builds[0]!;
    expect(build.libraries).toEqual([
      { name: 'SevSeg', source: 'provided' },
      { name: 'RTClib', source: 'provided' },
    ]);
    // The bench project carries the declarations; versions unpinned means the
    // manifest defaults apply at fetch time.
    expect(firmwareForBuild(build, 'arduino-cpp').libraries).toEqual(build.libraries);
  });

  it('declares no libraries on the raw builds', () => {
    for (const id of ['safe', 'dashboard', 'parking', 'weather', 'reaction'] as const) {
      expect(galleryById(id)!.builds[0]!.libraries, `${id} declares no libraries`).toEqual([]);
    }
  });

  /*
   * Live parity for the library-declared alarm build: the same glass, colon,
   * and serial observables as the raw-GPIO build, running under `execution
   * avr` with the declared libraries attached. Gated three ways — toolchain,
   * Tier-2 fetch, committed HEX — with a skip-with-reason for each, the same
   * pattern the other avr legs use.
   */
  it('runs the library-declared alarm build', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch { /* fall through to skip */ }
    if (!pkg) {
      console.warn('SKIP avr parity: toolchain absent');
      return;
    }
    if (!hexAvailable()) {
      console.warn('SKIP avr parity: no HEX');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP avr parity: Tier-2 fetch unreachable');
      return;
    }
    const build = galleryById('alarm-clock')!.builds[0]!;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    build.setup(simulation);
    const firmware = firmwareForBuild(build, 'arduino-cpp');
    expect(firmware.libraries, 'alarm build declares its libraries').toEqual([
      { name: 'SevSeg', source: 'provided' },
      { name: 'RTClib', source: 'provided' },
    ]);
    simulation.loadFirmware(firmware);
    expect(simulation.firmwareError, 'alarm-clock firmware').toBeNull();
    simulation.start();
    const glass = (): string => {
      const seg = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
      const ctrl = simulation.displayControllers().get(seg.id) as unknown as SevenSegment;
      return ctrl.getText();
    };
    // The glass itself, sampled like the live LCD leg: every digit holds '0'
    // at midnight, and the colon blinks once a second beside them.
    const colonSamples: boolean[] = [];
    for (let frame = 0; frame < 120; frame++) {
      simulation.tick(0.05);
      if (frame % 20 === 19) {
        const segPart = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
        const probe = {
          values: [] as number[],
          digits: 0,
          colon: false,
          colonValue: false,
        } as unknown as HTMLElement;
        pushWokwiState(probe, segPart.definition, segPart, {
          pinVolts: simulation.pinVoltages(),
          displays: simulation.displayControllers(),
        } as unknown as FootprintState);
        colonSamples.push((probe as unknown as { colonValue: boolean }).colonValue);
      }
    }
    expect(new Set(colonSamples), 'declared build colon blinks once a second').toEqual(
      new Set([false, true]),
    );
    // The digits themselves must move: midnight, then one minute later.
    for (let frame = 0; frame < 30; frame++) simulation.tick(0.05);
    expect(glass(), 'declared build idles at midnight').toBe('0000');
    simulation.engine.timeMs += 61000;
    for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
    expect(glass(), 'declared build shows 00:01 a minute later').toBe('0001');
    // The serial log carries one t=H:M:S line per loop: the seconds in them
    // must advance, proving the RTC ticks under the display.
    const seconds = [...simulation.serialLines().join('').matchAll(/t=\d+:\d+:(\d+)/g)].map(
      (match) => Number(match[1]),
    );
    expect(new Set(seconds).size, 'declared build clock ticks').toBeGreaterThan(1);
  }, 180_000);

  /*
   * Live Tier-2 runtime proof: a NEW fixture sketch (the gallery sketch above
   * stays raw-GPIO) that includes the recorded Tier-2 headers, instantiates
   * their objects, and calls their API every loop — SevSeg multiplexing plus
   * an RTC read. Every name used exists in the recorded sources (SevSeg
   * 3.7.0: `SevSeg`, `begin(COMMON_ANODE, ...)`, `setNumber`,
   * `refreshDisplay`; RTClib 2.1.4: `RTC_DS1307`, `begin`, `now`, `DateTime`
   * `hour`/`minute`). The bench reuses the alarm wiring so the digit commons
   * sit on D2-D5. Gated on toolchain + Tier-2 fetch with the same
   * skip-with-reason pattern; on skip the test passes vacuously.
   */
  it('runs a Tier-2 SevSeg+RTClib fixture live on the bench', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch { /* fall through to skip */ }
    if (!pkg) {
      console.warn('SKIP Tier-2 fixture: toolchain absent');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP Tier-2 fixture: Tier-2 fetch unreachable');
      return;
    }
    const alarmSetup = galleryById('alarm-clock')!.builds[0]!.setup;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    alarmSetup(simulation);
    const fixture = `#include <Arduino.h>
#include <Wire.h>
#include <SevSeg.h>
#include <RTClib.h>

SevSeg sevseg;
RTC_DS1307 rtc;

byte digitPins[4] = {2, 3, 4, 5};
byte segmentPins[8] = {6, 7, 8, 9, 10, 11, 12, 13};

void setup() {
  Wire.begin();
  rtc.begin();
  sevseg.begin(COMMON_ANODE, 4, digitPins, segmentPins, false, false, false);
  sevseg.setBrightness(90);
}

void loop() {
  DateTime t = rtc.now();
  sevseg.setNumber(t.hour() * 100 + t.minute());
  sevseg.refreshDisplay();
}
`;
    const firmware = firmwareForBuild(
      {
        board: 'uno',
        setup: alarmSetup,
        sketch: fixture,
        libraries: [
          { name: 'SevSeg', source: 'provided' },
          { name: 'RTClib', source: 'provided' },
        ],
      },
      'arduino-cpp',
    );
    await simulation.compileAndRun(firmware);
    expect(simulation.compileState, 'Tier-2 fixture compiles').toBe('ready');
    expect(simulation.firmwareError, 'Tier-2 fixture firmware').toBeNull();
    simulation.start();
    // D2-D5 are the four digit commons; COMMON_ANODE drives the selected
    // digit HIGH, sampled the same way as the raw-GPIO multiplexing legs.
    let digitSeenHigh = false;
    for (let frame = 0; frame < 120; frame++) {
      simulation.tick(0.05);
      if (simulation.firmwareError !== null) break;
      for (const gpio of [2, 3, 4, 5]) {
        if (simulation.engine.readDigital(gpio)) digitSeenHigh = true;
      }
    }
    expect(digitSeenHigh, 'Tier-2 SevSeg multiplexes its digits').toBe(true);
    expect(simulation.firmwareError, 'Tier-2 fixture runs without fault').toBeNull();
    // Budget: a cold Tier-2 build compiles eight translation units through
    // the wasm toolchain (measured ~2 min, not seconds); the browser reuses
    // its versioned cache across sessions, Node rebuilds every run.
  }, 1_500_000);

  /*
   * Live on the bench, not just wired: the glass must show the project's own
   * text and keep showing new text as time moves. This is the test that would
   * have caught the D2 pin collision (blank/garbled LCD) and the frozen RTC
   * (a clock that never ticks) before any learner did.
   *
   * The alarm clock drives a multiplexed 7-segment display straight from GPIO
   * rather than through a text controller, so the test watches the solved
   * nets instead: the last-driven digit common stays high through the delay,
   * and the serial log proves the RTC is ticking underneath it.
   */
  it('runs each LCD project live on the bench', () => {
    for (const execution of ['interpreter', 'avr'] as const) {
    for (const id of ['alarm-clock', 'weather'] as const) {
      const entry = galleryById(id)!;
      const build = entry.builds[0];
      const board = boardOption('uno').make();
      const simulation = new Simulation(board);
      simulation.execution = execution;
      if (execution === 'avr' && !hexAvailable()) { console.warn('SKIP avr parity: no HEX'); continue; }
      simulation.addPart(board, 0, 0);
      simulation.addPart(breadboardDefinition(), 230, 0);
      build.setup(simulation);
      simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
      expect(simulation.firmwareError, `${id} firmware`).toBeNull();
      simulation.start();
      if (id === 'alarm-clock') {
        let digitSeenHigh = false;
        const segPartEarly = (): NonNullable<ReturnType<Simulation['bench']['parts']['find']>> =>
          // Resolved per frame: the part list is stable, but looking it up
          // here keeps the sampling loop honest about what is on the bench.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
        const colonSamples: boolean[] = [];
        for (let frame = 0; frame < 120; frame++) {
          simulation.tick(0.05);
          // D2-D5 are the four digit commons; the last-driven one persists
          // HIGH through the end-of-loop delay.
          for (const gpio of [2, 3, 4, 5]) {
            if (simulation.engine.readDigital(gpio)) digitSeenHigh = true;
          }
          if (frame % 20 === 19) {
            const probe = {
              values: [] as number[],
              digits: 0,
              colon: false,
              colonValue: false,
            } as unknown as HTMLElement;
            pushWokwiState(probe, segPartEarly().definition, segPartEarly(), {
              pinVolts: simulation.pinVoltages(),
              displays: simulation.displayControllers(),
            } as unknown as FootprintState);
            const target = probe as unknown as { colonValue: boolean };
            colonSamples.push(target.colonValue);
          }
        }
        expect(digitSeenHigh, `${id} multiplexes its digits`).toBe(true);
        // The glass itself: push the solved state into the Wokwi element and
        // read back all four digits. The bench starts at midnight, so every
        // digit holds '0' — segments A-F lit, G dark, DP dark. The colon
        // blinks once a second beside them.
        const segPart = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
        const element = {
          values: [] as number[],
          digits: 0,
          colon: false,
          colonValue: false,
        } as unknown as HTMLElement;
        pushWokwiState(element, segPart.definition, segPart, {
          pinVolts: simulation.pinVoltages(),
          displays: simulation.displayControllers(),
        } as unknown as FootprintState);
        const values = (element as unknown as { values: number[] }).values;
        expect(values).toHaveLength(32);
        for (let d = 0; d < 4; d++) {
          const slice = values.slice(d * 8, d * 8 + 8);
          expect(slice, `${id} digit ${d + 1} shows 0`).toEqual([1, 1, 1, 1, 1, 1, 0, 0]);
        }
        const colonState = element as unknown as { colon: boolean; colonValue: boolean };
        expect(colonState.colon, `${id} colon enabled`).toBe(true);
        // The blink proves the glass moves every second, not just once a minute.
        expect(new Set(colonSamples), `${id} colon blinks once a second`).toEqual(
          new Set([false, true]),
        );
        // Buttons rest HIGH on their pull-ups; the disarmed buzzer rests LOW.
        expect(simulation.engine.readDigital(14), `${id} hours button released`).toBe(true);
        expect(simulation.engine.readDigital(15), `${id} minutes button released`).toBe(true);
        expect(simulation.engine.readDigital(16), `${id} alarm button released`).toBe(true);
        expect(simulation.engine.readDigital(17), `${id} buzzer silent while disarmed`).toBe(false);
        // The serial log carries one t=H:M:S line per loop: the seconds in
        // them must advance, proving the RTC ticks under the display.
        const seconds = [...simulation.serialLines().join('').matchAll(/t=\d+:\d+:(\d+)/g)].map(
          (match) => Number(match[1]),
        );
        expect(new Set(seconds).size, `${id} clock ticks`).toBeGreaterThan(1);
        // A tap on Alarm exercises the multi-file path end to end: the
        // button module's release verdict, the clock module's toggle plus
        // NVRAM save over real I2C writes, and the status view switch.
        const alarmButton = simulation.bench.parts.filter(
          (p) => p.definition.name === 'Tactile Button',
        )[2]!;
        simulation.setPressed(alarmButton.id, true);
        for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
        simulation.setPressed(alarmButton.id, false);
        for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
        expect(simulation.firmwareError, `${id} still runs after the tap`).toBeNull();
        expect(
          simulation.serialLines().join(''),
          `${id} alarm toggles on a short press`,
        ).toContain('alarm toggled');
        continue;
      }
      const glasses: string[] = [];
      for (let frame = 0; frame < 120; frame++) {
        simulation.tick(0.05);
        if (frame % 40 === 39) {
          const lcd = [...simulation.lcdModels().values()][0];
          glasses.push(lcd ? lcd.text() : '');
        }
      }
      for (const glass of glasses) {
        expect(glass, `${id} glass shows readings`).toMatch(/t \d/);
        expect(glass, `${id} glass shows humidity`).toMatch(/rh \d/);
      }
    }
    }
    // Budget covers the newly-live avr legs: cycle-accurate 16 MHz
    // simulation of 120 frames x 4 combos costs ~40 s solo, more under
    // full-suite load (the 60 s budget dates from when avr legs skipped).
  }, 180_000);

  /*
   * The digits themselves must move — over RTC time and under the buttons.
   * Idle glass, DP blink and serial ticks all passed while the numbers never
   * budged, which is exactly the reported symptom, so this test watches the
   * decoded text: midnight, one minute later, then an Hour tap on top.
   */
  it('moves the alarm-clock digits over time and on button taps', () => {
    for (const execution of ['interpreter', 'avr'] as const) {
    const build = galleryById('alarm-clock')!.builds[0];
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = execution;
    if (execution === 'avr' && !hexAvailable()) { console.warn('SKIP avr parity: no HEX'); continue; }
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    build.setup(simulation);
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError, 'alarm-clock firmware').toBeNull();
    simulation.start();
    const glass = (): string => {
      const seg = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
      const ctrl = simulation.displayControllers().get(seg.id) as unknown as SevenSegment;
      return ctrl.getText();
    };
    for (let frame = 0; frame < 30; frame++) simulation.tick(0.05);
    expect(glass(), 'idle shows midnight').toBe('0000');
    // A minute of RTC time must move the minute digits.
    simulation.engine.timeMs += 61000;
    for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
    expect(glass(), 'a minute later shows 00:01').toBe('0001');
    // An Hour tap retunes the shown time through the persisted offset. The
    // hold may additionally trip one auto-repeat tick, so either +1 or +2.
    const hours = simulation.bench.parts.filter((p) => p.definition.name === 'Tactile Button')[0]!;
    simulation.setPressed(hours.id, true);
    for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
    simulation.setPressed(hours.id, false);
    for (let frame = 0; frame < 22; frame++) simulation.tick(0.05);
    expect(glass(), 'hour tap moves the hour digits').toMatch(/^0[12]01$/);
    }
  }, 60_000);

  /*
   * Live AVR legs for the alarm library build (Task 2's AVR-only entry:
   * verbatim urish sources with SevSeg/RTClib, flashed from the committed
   * library HEX). Same simulation shape and helpers as the raw legs above —
   * AVR-only, since the interpreter cannot parse classes — gated on the HEX
   * with the file's skip pattern.
   *
   * Two adaptations the bench forces, both verified by execution (see the
   * Task 8 report): the interpreter rejection is the pinned AVR-only
   * contract, so firmwareError carries it while the HEX runs underneath;
   * and the SevSeg multiplex cycles segments rather than digits, so decoded
   * digits are accumulated over full multiplex frames instead of read off
   * the edge-latched glass. The colon, DP, buzzer, and worker legs are
   * verbatim: those pins are driven directly, not multiplexed.
   */
  it('runs the alarm library build live (AVR)', () => {
    const libHex = join(__dirname, '..', 'simulation', 'avr', 'hex', 'alarm-clock-lib-uno.hex');
    if (!hexAvailable() || !existsSync(libHex)) {
      console.warn('SKIP library build live: no HEX');
      return;
    }
    const build = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    build.setup(simulation);
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    // AVR-only by contract: the interpreter stops at the class sources while
    // the committed HEX runs underneath. A fault would overwrite this with
    // its own message, so the rejection standing also proves no fault.
    expect(simulation.firmwareError ?? '', 'library build is AVR-only').toMatch(
      /expected a type|not found|expected ';'|expected number/,
    );
    simulation.start();
    for (let frame = 0; frame < 30; frame++) simulation.tick(0.05);
    const midnight = convergeGlass(simulation, 70);
    expect(midnight.converged, 'library build multiplex settles at midnight').toBe(true);
    expect(midnight.glyphs, 'library build idles at midnight').toEqual([
      ZERO_GLYPH,
      ZERO_GLYPH,
      ZERO_GLYPH,
      ZERO_GLYPH,
    ]);
    simulation.engine.timeMs += 61000;
    for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
    const minute = convergeGlass(simulation, 70);
    expect(minute.converged, 'library build multiplex settles a minute later').toBe(true);
    expect(minute.glyphs, 'library build shows 00:01 a minute later').toEqual([
      ZERO_GLYPH,
      ZERO_GLYPH,
      ZERO_GLYPH,
      ONE_GLYPH,
    ]);
    // Colon blinks: sample colonValue like the raw legs. Ticks advance 40 ms
    // (the frame budget cap), so three samples a second apart always span
    // both parities of the once-a-second blink — 60 frames prove the blink
    // at half the cost of the raw legs' 120.
    const segPart = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
    const colonSamples: boolean[] = [];
    for (let frame = 0; frame < 60; frame++) {
      simulation.tick(0.05);
      if (frame % 20 === 19) {
        const probe = { values: [] as number[], digits: 0, colon: false, colonValue: false } as unknown as HTMLElement;
        pushWokwiState(probe, segPart.definition, segPart, {
          pinVolts: simulation.pinVoltages(),
          displays: simulation.displayControllers(),
        } as unknown as FootprintState);
        colonSamples.push((probe as unknown as { colonValue: boolean }).colonValue);
      }
    }
    expect(new Set(colonSamples), 'library colon blinks').toEqual(new Set([false, true]));
    // DP slice stays dark: SevSeg begun with 7 segment pins.
    const element = { values: [] as number[], digits: 0, colon: false, colonValue: false } as unknown as HTMLElement;
    pushWokwiState(element, segPart.definition, segPart, {
      pinVolts: simulation.pinVoltages(),
      displays: simulation.displayControllers(),
    } as unknown as FootprintState);
    const values = (element as unknown as { values: number[] }).values;
    expect(values).toHaveLength(32);
    for (let d = 0; d < 4; d++) expect(values.slice(d * 8 + 7, d * 8 + 8)).toEqual([0]);
  }, 180_000);

  /*
   * Status view + NVRAM + buzzer for the library build: a short Alarm press
   * arms the clock (toggleAlarm saves over real I2C writes), the glass
   * switches to the setChars status view, an MCU reset proves the NVRAM
   * round-trip (the clock comes back armed), and with the alarm due the
   * siren drives A3 — liveness across samples, never exact timing.
   *
   * Two bench facts shape the choreography. First, setPressed rebuilds the
   * bench and recreates the RTC model, wiping its RAM — so the button stays
   * held from the arming press until the rebooted clock has been read back;
   * only then is it released. Second, with the button held through the
   * reset, the rebooted clock toggles straight back off (the held edge
   * reads as a fresh press), landing in the status view: " off" proves the
   * save survived, while a wiped NVRAM would boot disarmed and show " on".
   */
  it('runs the alarm library build live status, NVRAM, and buzzer (AVR)', () => {
    const libHex = join(__dirname, '..', 'simulation', 'avr', 'hex', 'alarm-clock-lib-uno.hex');
    if (!hexAvailable() || !existsSync(libHex)) {
      console.warn('SKIP library build live: no HEX');
      return;
    }
    const build = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    build.setup(simulation);
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError ?? '', 'library build is AVR-only').toMatch(
      /expected a type|not found|expected ';'|expected number/,
    );
    simulation.start();
    const alarmButton = simulation.bench.parts.filter(
      (p) => p.definition.name === 'Tactile Button',
    )[2]!;
    // Fresh NVRAM starts disarmed (zeroed model NVRAM ⇒ DISABLED per
    // Clock::begin): the buzzer rests LOW before anything is armed.
    for (let frame = 0; frame < 8; frame++) simulation.tick(0.05);
    expect(simulation.engine.readDigital(17), 'library build buzzer silent while disarmed').toBe(false);
    // Arming press: the toggle saves NVRAM over real I2C writes and the
    // glass switches to the setChars status view — the SevSeg API the
    // fixture never covers. ALARM_STATUS_DISPLAY_TIME is 1000 ms, so the
    // status is settled mid-hold (10 ms ticks, 60-frame cap) while the view
    // is guaranteed up. ' ' stays blank, 'o' renders as 'O' (same segments
    // as '0'), 'n' lights C/E/G. Blank digits keep stale bits, so only the
    // driven digits are asserted. The button stays held past the reset.
    simulation.setPressed(alarmButton.id, true);
    for (let frame = 0; frame < 10; frame++) simulation.tick(0.01);
    const status = convergeGlass(simulation, 60);
    expect(status.converged, 'library build status view settles').toBe(true);
    expect(status.glyphs[1], 'library build status shows O').toEqual(ZERO_GLYPH);
    expect(status.glyphs[2], 'library build status shows n').toEqual(N_GLYPH);
    expect(simulation.firmwareError ?? '', 'library build still runs after the tap').toMatch(
      /expected a type|not found|expected ';'|expected number/,
    );
    // NVRAM round-trip: reset the MCU core — setup() reruns and Clock::begin()
    // rereads the DS1307's RAM, which the reset preserves (only a rebuild
    // recreates the model). The held edge toggles the rebooted clock straight
    // back off, so " off" (blank, 'O', 'F', 'F') proves the save survived —
    // a wiped NVRAM would boot disarmed and show " on".
    const core = (simulation as unknown as { avrBackend: { reset(): void } | null }).avrBackend;
    expect(core, 'library build AVR core flashed').not.toBeNull();
    core!.reset();
    for (let frame = 0; frame < 8; frame++) simulation.tick(0.05);
    const rearmed = convergeGlass(simulation, 60);
    expect(rearmed.converged, 'library build second status view settles').toBe(true);
    expect(rearmed.glyphs[1], 'library build NVRAM persists the arm (O)').toEqual(ZERO_GLYPH);
    expect(rearmed.glyphs[2], 'library build NVRAM persists the arm (F)').toEqual(F_GLYPH);
    expect(rearmed.glyphs[3], 'library build NVRAM persists the arm (F)').toEqual(F_GLYPH);
    expect(simulation.firmwareError ?? '', 'library build still runs after reset').toMatch(
      /expected a type|not found|expected ';'|expected number/,
    );
    // Release only now that the read-back is proven. Releasing rebuilds the
    // bench and recreates the RTC model, so the save is gone — but the
    // firmware's own save already went out over real I2C (asserted on the
    // bus log below), and the reboot read-back above proved the model side.
    // For the siren leg, stage an armed save directly (the same two bytes
    // toggleAlarm emits) and reset: the rebooted clock boots armed with no
    // button choreography in the way, sees the due alarm, and rings.
    simulation.setPressed(alarmButton.id, false);
    for (let frame = 0; frame < 8; frame++) simulation.tick(0.05);
    const saves = simulation
      .busLines()
      .filter((entry) => entry.bus === 'i2c' && entry.address === 0x68)
      .map((entry) => [...entry.bytes]);
    expect(saves, 'library build saves the arm over I2C').toContainEqual([8, 1]);
    expect(simulation.engine.writeI2C(0x68, 0x08, true), 'library build NVRAM staged').toBe(true);
    expect(simulation.engine.writeI2C(0x68, 0x01, false), 'library build NVRAM staged').toBe(true);
    core!.reset();
    for (let frame = 0; frame < 10; frame++) simulation.tick(0.05);
    // Live buzzer: the alarm is due — the staged save arms 00:00 while the
    // RTC sits just past midnight — so the rebooted clock walks straight
    // into the alarm state and the siren drives A3: liveness across
    // samples, never exact timing.
    let buzzerSeenHigh = false;
    for (let frame = 0; frame < 25; frame++) {
      simulation.tick(0.05);
      if (simulation.engine.readDigital(17)) buzzerSeenHigh = true;
    }
    expect(buzzerSeenHigh, 'library build buzzer rings while the alarm is due').toBe(true);
    expect(simulation.firmwareError ?? '', 'library build still runs while ringing').toMatch(
      /expected a type|not found|expected ';'|expected number/,
    );
  }, 180_000);

  /*
   * Worker-compile leg for the library build: the committed HEX proves the
   * recorded sources built once, but only a live worker compile proves the
   * gallery sources plus their declared libraries still compile now. Mirrors
   * the Tier-2 fixture shape (toolchain + Tier-2 gates, 1_500_000 budget):
   * compileAndRun → compileState 'ready', firmwareError null, then ticks
   * without fault.
   */
  it('runs the alarm library build live worker compile (AVR Tier-2)', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch { /* fall through to skip */ }
    if (!pkg) {
      console.warn('SKIP library build worker compile: toolchain absent');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP library build worker compile: Tier-2 fetch unreachable');
      return;
    }
    const libBuild = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    libBuild.setup(simulation);
    await simulation.compileAndRun(firmwareForBuild(libBuild, 'arduino-cpp'));
    expect(simulation.compileState, 'library build compiles').toBe('ready');
    expect(simulation.firmwareError, 'library build firmware').toBeNull();
    simulation.start();
    for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
    expect(simulation.firmwareError, 'library build runs without fault').toBeNull();
    // Budget: a cold Tier-2 build compiles the firmware TU plus the SevSeg
    // and RTClib TUs through the wasm toolchain (measured in minutes, not
    // seconds); the browser reuses its versioned cache across sessions, Node
    // rebuilds every run.
  }, 1_500_000);
});
