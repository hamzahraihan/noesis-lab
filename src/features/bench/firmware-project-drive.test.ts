import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { arduinoUnoR3 } from '@/features/parts';

function bench() {
  return new Simulation(arduinoUnoR3());
}

describe('loadFirmware with a project', () => {
  it('runs helpers across tabs', () => {
    const sim = bench();
    sim.loadFirmware({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [
        { name: 'main.ino', content: '#include "helpers.h"\nvoid setup() { pinMode(2, 1); }\nvoid loop() {}\n' },
        { name: 'helpers.h', content: 'void helper() {}\n' },
      ],
    });
    expect(sim.firmwareError).toBeNull();
  });

  it('surfaces missing includes verbatim', () => {
    const sim = bench();
    sim.loadFirmware({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: '#include "missing.h"\nvoid setup() {}\nvoid loop() {}\n' }],
    });
    expect(sim.firmwareError).toContain('missing.h');
  });

  it('keeps the string overload working', () => {
    const sim = bench();
    sim.loadFirmware('void setup() {}\nvoid loop() {}\n', 'arduino-cpp');
    expect(sim.firmwareError).toBeNull();
  });
});
