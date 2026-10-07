import { describe, expect, it } from 'vitest';
import { PART_CATALOGUE } from '../sim/catalogue';
import { breadboardDefinition } from '../sim/breadboard';
import { boardOption, type BoardId } from './boardRegistry';
import { GALLERY, boardsFor, buildFor, galleryById } from './gallery';
import { previewBench } from './exercise-preview-data';
import { Simulation } from './simulation';

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
      'alarm-clock': 16,
      safe: 14,
      dashboard: 14,
      parking: 15,
      weather: 12,
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
});
