import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PART_CATALOGUE, SevenSegment, breadboardDefinition } from '@/features/parts';
import { boardOption, type BoardId } from './boardRegistry';
import { GALLERY, boardsFor, buildFor, firmwareForBuild, galleryById } from './gallery';
import { TIER2_MANIFEST } from '@/features/simulation';
import { previewBench } from './exercise-preview-data';
import { Simulation } from '@/features/bench/simulation';
import { pushWokwiState } from '@/features/bench/wokwi';
import type { FootprintState } from '@/features/bench/footprints';

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
      expect(boardsFor(entry)).toEqual(entry.builds.map((build) => build.board));
      for (const board of boardsFor(entry)) {
        expect(buildFor(entry, board)?.board).toBe(board);
      }
      expect(buildFor(entry, 'mega')).toBeNull();
    }
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
        expect(simulation.firmwareError, `${entry.id}/${build.board}: ${simulation.firmwareError}`).toBeNull();
      }
    }
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
});
