import { describe, expect, it } from 'vitest';
import { PART_CATALOGUE } from '../sim/catalogue';
import { breadboardDefinition } from '../sim/breadboard';
import { boardOption } from './boardRegistry';
import { GALLERY, galleryById } from './gallery';
import { previewBench } from './exercise-preview-data';
import { Simulation } from './simulation';

const CATALOGUE_NAMES = new Set(PART_CATALOGUE.map((entry) => entry.make().name));

function freshBench() {
  const board = boardOption('uno').make();
  const simulation = new Simulation(board);
  simulation.addPart(board, 0, 0);
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
  it('numbers every project uniquely and tags real boards', () => {
    const ids = GALLERY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of GALLERY) {
      expect(entry.boards.length).toBeGreaterThan(0);
      for (const board of entry.boards) {
        expect(boardOption(board).id).toBe(board);
      }
      expect(galleryById(entry.id)?.id).toBe(entry.id);
    }
    expect(galleryById('nope')).toBeNull();
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

  it('parses every sketch through the real parser', () => {
    for (const entry of GALLERY) {
      const simulation = freshBench();
      simulation.loadFirmware(entry.sketch, 'arduino-cpp');
      expect(simulation.firmwareError, `${entry.id} sketch: ${simulation.firmwareError}`).toBeNull();
    }
  });

  it('wires each project onto the bench without throwing', () => {
    // Exact counts, measured from the setups: deterministic wiring means a
    // skipped leg changes the number, and the number is what catches it.
    const wireFloors: Record<string, number> = {
      'alarm-clock': 16,
      safe: 14,
      dashboard: 14,
      parking: 15,
      weather: 12,
    };
    for (const entry of GALLERY) {
      const simulation = freshBench();
      expect(() => entry.setup(simulation), `${entry.id} setup`).not.toThrow();
      expect(simulation.bench.wires.length, `${entry.id} wires`).toBeGreaterThanOrEqual(
        wireFloors[entry.id] ?? 1,
      );
      const real = partTerminals(simulation);
      const touched = new Set<number>();
      for (const wire of simulation.bench.wires) {
        expect(real.has(wire.from), `${entry.id} wire from`).toBe(true);
        expect(real.has(wire.to), `${entry.id} wire to`).toBe(true);
        touched.add(wire.from);
        touched.add(wire.to);
      }
      // Every listed part made it onto the bench, in the listed quantity.
      for (const part of entry.parts) {
        const placed = simulation.bench.parts.filter((p) => p.definition.name === part.name).length;
        expect(placed, `${entry.id} "${part.name}" qty`).toBeGreaterThanOrEqual(part.qty);
      }
      // Every placed project part is touched by at least one jumper: a
      // misspelled pin skips its leg silently (setups return early rather
      // than throw), and an untouched part is what that looks like.
      for (const part of simulation.bench.parts) {
        const kind = part.definition.component.kind;
        if (kind === 'mcu' || kind === 'breadboard') continue;
        const wired = Object.values(part.terminals).some((id) => touched.has(id));
        expect(wired, `${entry.id} "${part.definition.name}" wired`).toBe(true);
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

  it('frames every project preview on real content', () => {
    for (const entry of GALLERY) {
      const preview = previewBench(entry.boards[0], entry.setup, `gallery:${entry.id}`);
      expect(preview.parts.length, `${entry.id} parts`).toBeGreaterThan(0);
      expect(preview.frame.width, `${entry.id} width`).toBeGreaterThan(0);
      expect(preview.frame.height, `${entry.id} height`).toBeGreaterThan(0);
      expect(preview.paths.length, `${entry.id} paths`).toBeGreaterThan(0);
    }
  });
});
