import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { toSingleFileProject } from '@/features/simulation';
import { arduinoUnoR3 } from '@/features/parts';
import { avrAvailableFor } from './avr-mode';

describe('avr mode availability', () => {
  it('is available on the Uno', () => {
    expect(avrAvailableFor('uno')).toEqual({ ok: true });
  });

  it('is refused elsewhere with a reason', () => {
    expect(avrAvailableFor('mega')).toEqual({ ok: false, reason: expect.any(String) });
  });
});

describe('avr compile failure landing', () => {
  it('reports library file:line from worker failures', async () => {
    const simulation = new Simulation(arduinoUnoR3(), {
      avrCompile: async () => {
        throw { message: 'boom', tab: 'MyLib.cpp', line: 3 };
      },
    });
    await simulation.compileAndRun(
      toSingleFileProject('void setup() {}\nvoid loop() {}\n', 'arduino-cpp'),
    );
    expect(simulation.firmwareError).toContain('MyLib.cpp:3');
  });
});
