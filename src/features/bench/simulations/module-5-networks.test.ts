import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { boardOption } from '@/features/learn/boardRegistry';
import { EXERCISES, exerciseBoard, exerciseById, exerciseLanguage } from '@/features/learn';
import type { Ili9341 } from '@/features/parts';

/**
 * Lesson 5.3, run.
 *
 * The curriculum's own tests prove the circuit loads and the sketch parses;
 * what they cannot see is the thing the lesson is about: two answers arriving
 * on the network's schedule while one loop keeps up with both. So this runs it
 * and reads the serial the way a learner would.
 */

describe('the network lesson', () => {
  it('is on the curriculum, on the board it was written for', () => {
    const lesson = exerciseById('5.3')!;
    expect(lesson.board).toBe('esp32');
    expect(EXERCISES).toContain(lesson);
  });

  it('asks, listens, and does both without stopping', () => {
    const lesson = exerciseById('5.3')!;
    const simulation = new Simulation(boardOption(exerciseBoard(lesson)).make());
    expect(simulation.loadCircuit(lesson.circuit)).toEqual([]);
    simulation.loadFirmware(lesson.sketch, exerciseLanguage(lesson));
    simulation.start();
    // Fifteen simulated seconds: long enough for the clock to be asked at
    // boot, five and ten, and for fifteen readings to arrive in between.
    for (let frame = 0; frame < 300; frame++) simulation.tick(0.05);

    expect(simulation.firmwareError).toBeNull();
    const serial = simulation.serialLines().join('');
    expect(serial).toContain('ip 192.168.4.10');
    expect(serial).toContain('subscribed 1');

    // The two jobs, both advancing: the sensor's feed kept arriving *while*
    // the clock was being asked, which is the failure this lesson prevents.
    const temps = serial.match(/temp \d+\.\d/g) ?? [];
    const times = new Set(serial.match(/time 2026-10-17T12:00:\d\dZ/g) ?? []);
    expect(temps.length, 'readings while the clock was busy').toBeGreaterThan(8);
    expect(times.size, 'the clock asked again').toBeGreaterThan(1);

    // And both reached the glass.
    const panel = [...simulation.displayControllers().values()][0] as Ili9341;
    expect(panel.isOn()).toBe(true);
    let drawn = false;
    for (let y = 120; y < 240 && !drawn; y++) {
      for (let x = 20; x < 400 && !drawn; x++) {
        if (panel.pixelAt(x, y) !== 0) drawn = true;
      }
    }
    expect(drawn, 'the answers were drawn').toBe(true);
  }, 30_000);
});
