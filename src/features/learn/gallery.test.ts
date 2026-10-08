import { describe, expect, it } from 'vitest';
import { PART_CATALOGUE } from '@/features/parts';
import { breadboardDefinition } from '@/features/parts';
import { boardOption, type BoardId } from './boardRegistry';
import { GALLERY, boardsFor, buildFor, galleryById } from './gallery';
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
        simulation.loadFirmware(build.sketch, boardOption(build.board).language);
        expect(simulation.firmwareError, `${entry.id}/${build.board}: ${simulation.firmwareError}`).toBeNull();
      }
    }
  });

  it('wires every build onto its board bench without throwing', () => {
    const wireFloors: Record<string, number> = {
      'alarm-clock': 24,
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
    for (const id of ['alarm-clock', 'weather'] as const) {
      const entry = galleryById(id)!;
      const build = entry.builds[0];
      const board = boardOption('uno').make();
      const simulation = new Simulation(board);
      simulation.addPart(board, 0, 0);
      simulation.addPart(breadboardDefinition(), 230, 0);
      build.setup(simulation);
      simulation.loadFirmware(build.sketch, 'arduino-cpp');
      expect(simulation.firmwareError, `${id} firmware`).toBeNull();
      simulation.start();
      if (id === 'alarm-clock') {
        let digitSeenHigh = false;
        for (let frame = 0; frame < 120; frame++) {
          simulation.tick(0.05);
          // D2-D5 are the four digit commons; the last-driven one persists
          // HIGH through the end-of-loop delay.
          for (const gpio of [2, 3, 4, 5]) {
            if (simulation.engine.readDigital(gpio)) digitSeenHigh = true;
          }
        }
        expect(digitSeenHigh, `${id} multiplexes its digits`).toBe(true);
        // The glass itself: push the solved state into the Wokwi element and
        // read back all four digits. The bench starts at midnight, so every
        // digit holds '0' — segments A-F lit, G and DP dark.
        const segPart = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
        const element = { values: [] as number[], digits: 0 } as unknown as HTMLElement;
        pushWokwiState(element, segPart.definition, segPart, {
          pinVolts: simulation.pinVoltages(),
          displays: simulation.displayControllers(),
        } as unknown as FootprintState);
        const values = (element as unknown as { values: number[] }).values;
        expect(values).toHaveLength(32);
        for (let d = 0; d < 4; d++) {
          expect(values.slice(d * 8, d * 8 + 8), `${id} digit ${d + 1} shows 0`).toEqual([
            1, 1, 1, 1, 1, 1, 0, 0,
          ]);
        }
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
  }, 60_000);
});
