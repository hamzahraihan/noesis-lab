import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { boardOption } from '@/features/learn/boardRegistry';
import { buildFor, firmwareForBuild, galleryById } from '@/features/learn/gallery';
import { breadboardDefinition } from '@/features/parts';

/**
 * AVR pin reads must observe the scheduled solve cadence (1-4ms via
 * onSettle), not settle per read: a polling sketch reads PIN bytes hundreds
 * of times per frame, at 8 settles per byte, for state that cannot have
 * meaningfully moved (button debounce alone is 25ms+).
 */
describe('AVR pin reads settle on cadence', () => {
  it('bounds engine solves while a polling sketch runs', () => {
    const build = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    build.setup(simulation);
    simulation.execution = 'avr';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    const engine = simulation.engine;
    const realSettle = engine.settle.bind(engine);
    let settles = 0;
    engine.settle = () => {
      settles++;
      return realSettle();
    };
    simulation.start();
    for (let frame = 0; frame < 30; frame++) simulation.tick(1 / 60);
    // Cadence solves (~125) + one per tick + loads: a few hundred at most.
    // Per-read settling costs ~1200/frame here (~36k measured).
    expect(settles).toBeLessThan(3000);
    // Budget mirrors the AVR-heavy gallery legs: 30 committed-HEX ticks cost
    // seconds alone and far more under full-suite CPU contention.
  }, 120_000);
});
