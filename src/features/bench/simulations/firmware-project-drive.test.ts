import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { toSingleFileProject } from '@/features/simulation';
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

  it('wraps legacy sketches as single-file projects', () => {
    const wrapped = toSingleFileProject('void setup() {}\n', 'arduino-cpp');
    expect(wrapped.files).toHaveLength(1);
    const sim = bench();
    sim.loadFirmware(wrapped);
    expect(sim.firmwareError).toBeNull();
  });

  it('reset() reloads the same project', () => {
    const sim = bench();
    sim.loadFirmware({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: '#include "missing.h"\nvoid setup() {}\nvoid loop() {}\n' }],
    });
    const before = sim.firmwareError;
    expect(before).toContain('missing.h');
    sim.reset();
    expect(sim.firmwareError).toBe(before);
  });

  it('keeps a valid project loaded across reset()', () => {
    const sim = bench();
    sim.loadFirmware({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [
        { name: 'main.ino', content: '#include "helpers.h"\nvoid setup() { helper(); }\nvoid loop() {}\n' },
        { name: 'helpers.h', content: 'void helper() {}\n' },
      ],
    });
    expect(sim.firmwareError).toBeNull();
    sim.reset();
    expect(sim.firmwareError).toBeNull();
    expect(sim.runner).not.toBeNull();
  });

  it('start() reloads the project when there is no runner', () => {
    const sim = bench();
    sim.loadFirmware({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: '#include "missing.h"\nvoid setup() {}\nvoid loop() {}\n' }],
    });
    expect(sim.runner).toBeNull();
    sim.start();
    expect(sim.running).toBe(true);
    expect(sim.firmwareError).toContain('missing.h');
  });
});
