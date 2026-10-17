import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import {
  boardOption,
  EXERCISES,
  exerciseById,
  exerciseLanguage,
  type Exercise,
} from '@/features/learn';
import type { Ili9341 } from '@/features/parts';

/**
 * The pocket-map lesson, on the bench.
 *
 * The second module-5 lesson and the first on a single-board computer: the
 * sketch is Python, the board is a Pi, and the panel is told what to draw
 * rather than shown a picture. The failure this file exists for is the quiet
 * one -- a lesson written, correct, and never wired into the curriculum, so
 * nobody can take it and no build goes red.
 */
const POCKET_MAP = '5.2';

function lesson(): Exercise {
  const exercise = exerciseById(POCKET_MAP);
  expect(exercise, 'the pocket-map lesson is on the curriculum').toBeTruthy();
  return exercise!;
}

function bench(): Simulation {
  const definition = boardOption('raspberry-pi').make();
  const simulation = new Simulation(definition);
  simulation.loadCircuit(lesson().circuit);
  return simulation;
}

describe('the pocket-map lesson', () => {
  it('is on the curriculum, on the board it was written for', () => {
    expect(EXERCISES.some((exercise) => exercise.id === POCKET_MAP)).toBe(true);
    // Stated, not inherited: wiring a Pi lesson against the curriculum's
    // default Uno would resolve no GPIO lines and quietly build nothing.
    expect(lesson().board).toBe('raspberry-pi');
  });

  it('puts the 2.4" panel and its button on the bench', () => {
    const simulation = bench();
    const displays = [...simulation.displayControllers().values()];
    const buttons = simulation.bench.parts.filter(
      (part) => part.definition.name === 'Tactile Button',
    );

    expect(displays.length).toBeGreaterThan(0);
    // One button: the waypoint walk. A Pi cannot read a knob, so this is the
    // whole input the lesson has.
    expect(buttons.length).toBe(1);

    const panel = displays[0] as Ili9341;
    expect(panel.width, 'the pocket panel is the 320-wide one').toBe(320);
  });

  it('runs every jumper through real holes', () => {
    const simulation = bench();
    expect(simulation.bench.wires.length).toBeGreaterThan(6);
  });

  it('lights the panel and draws the first waypoint', () => {
    const exercise = lesson();
    const simulation = bench();
    simulation.loadFirmware(exercise.sketch, exerciseLanguage(exercise));
    simulation.start();

    const panel = [...simulation.displayControllers().values()][0] as Ili9341;
    const marker = 'waypoint 0 at 24,200';

    // The first frame is most of the program: 320 x 240 pixels is 153,600
    // bytes on the wire at 8 MHz. Tick until the sketch reports it drew, not
    // for a fixed count that would drift with interpreter speed.
    for (let frame = 0; frame < 40; frame++) {
      simulation.tick(0.05);
      if (simulation.serial.join('').includes(marker)) break;
    }

    expect(simulation.firmwareError).toBeNull();
    expect(panel.isOn(), 'the panel was told to light').toBe(true);
    expect(
      simulation.serial.join(''),
      'the sketch should name the waypoint it drew',
    ).toContain(marker);
    /*
     * The loop above is bounded in *simulated* time (40 frames of 50 ms), so
     * what it asserts does not drift with machine speed -- but pushing a
     * 320x240 frame through the interpreter costs seconds of wall clock
     * (measured ~3 s alone, and over the 5 s default once the suite runs
     * beside anything else). The budget is the wall clock, and it is generous
     * on purpose: a slow machine should not report a wiring bug.
     */
  }, 30_000);
});
