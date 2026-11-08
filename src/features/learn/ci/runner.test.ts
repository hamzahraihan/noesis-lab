import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadCiProject } from './project';
import { runCiProject } from './runner';

/** The example project the documentation points at. */
const EXAMPLE = fileURLToPath(new URL('../../../../examples/ci/blink', import.meta.url));

/** The example that asserts what the bench itself is doing. */
const HARDWARE = fileURLToPath(new URL('../../../../examples/ci/hardware', import.meta.url));

/** The project that exercises the bench's simulated network. */
const NETWORK = fileURLToPath(new URL('../../../../examples/ci/network-time', import.meta.url));

/** The project that fetches three endpoints in sequence. */
const NETWORK_MULTI = fileURLToPath(new URL('../../../../examples/ci/network-multi', import.meta.url));

/** The project that exercises the failure path. */
const NETWORK_FAILURE = fileURLToPath(new URL('../../../../examples/ci/network-failure', import.meta.url));

/**
 * The project the environment names, when there is one.
 *
 * The CI run passes the folder in, so the same test is the whole check: a
 * project that is not being checked has nothing to say, and a test that
 * failed for the want of a folder would be a lie.
 */
const REQUESTED = process.env.NOESIS_PROJECT;

describe('the CI runner', () => {
  it('runs the example project and sees what it expects', () => {
    const project = loadCiProject(EXAMPLE);
    const run = runCiProject(project);
    expect(run.failures, run.failures.join('; ')).toEqual([]);
    expect(run.serial.join('')).toContain('blink ready');
  });

  it('says what a project did not do', () => {
    const project = loadCiProject(EXAMPLE);
    const run = runCiProject({
      ...project,
      expectations: { frames: 60, serial: ['never said this'], hardware: [] },
    });
    expect(run.failures.join('; ')).toContain('never said this');
  });

  it('reads the hardware a project asserts', () => {
    const project = loadCiProject(HARDWARE);
    const run = runCiProject(project);
    expect(run.failures, run.failures.join('; ')).toEqual([]);
    expect(run.hardware.map((reading) => reading.name)).toEqual([
      'volts p1:D13',
      'amps D13',
      'text p4',
    ]);
    expect(run.hardware.every((reading) => reading.ok)).toBe(true);
  });

  it('runs the network project and sees what it expects', () => {
    const project = loadCiProject(NETWORK);
    const run = runCiProject(project);
    expect(run.failures, run.failures.join('; ')).toEqual([]);
    expect(run.serial.join('')).toContain('connected');
    expect(run.serial.join('')).toContain('2026-10-17T12:00:00Z');
  });

  it('runs the multi-endpoint project and sees what it expects', () => {
    const project = loadCiProject(NETWORK_MULTI);
    const run = runCiProject(project);
    expect(run.failures, run.failures.join('; ')).toEqual([]);
    expect(run.serial.join('')).toContain('connected');
    expect(run.serial.join('')).toContain('20.0');
    expect(run.serial.join('')).toContain('40.0');
  });

  it('runs the network-failure project and sees what it expects', () => {
    const project = loadCiProject(NETWORK_FAILURE);
    const run = runCiProject(project);
    expect(run.failures, run.failures.join('; ')).toEqual([]);
    expect(run.serial.join('')).toContain('network failed');
    expect(run.serial.join('')).toContain('still running');
  });

  it('says what the hardware did not do', () => {
    const project = loadCiProject(EXAMPLE);
    const run = runCiProject({
      ...project,
      expectations: {
        frames: 60,
        serial: [],
        hardware: [
          { kind: 'volts', part: 'p1', pin: 'D13', min: 5.5, at: 10 },
          { kind: 'text', part: 'p1', contains: 'not an LCD' },
        ],
      },
    });
    const failures = run.failures.join('; ');
    expect(failures).toContain('volts p1:D13: expected at least 5.5 V on p1:D13, saw');
    expect(failures).toContain('text p1: p1 is not a character LCD');
  });

  it('samples a hardware assertion at the frame it names', () => {
    const project = loadCiProject(EXAMPLE);
    const run = runCiProject({
      ...project,
      expectations: {
        frames: 60,
        serial: [],
        hardware: [{ kind: 'volts', part: 'p1', pin: 'D13', max: 1, at: 40 }],
      },
    });
    expect(run.failures, run.failures.join('; ')).toEqual([]);
    expect(run.hardware).toEqual([{ at: 40, ok: true, name: 'volts p1:D13', detail: '' }]);
  });

  it('fails a sketch that will not compile', () => {
    const project = loadCiProject(EXAMPLE);
    const run = runCiProject({
      ...project,
      firmware: {
        ...project.firmware,
        files: [{ name: 'main.ino', content: 'void setup() { this is not c++ }' }],
      },
    });
    expect(run.failures.length).toBeGreaterThan(0);
  });

  it.skipIf(REQUESTED === undefined)('runs the project the environment names', () => {
    const project = loadCiProject(REQUESTED!);
    const run = runCiProject(project);
    expect(run.failures, run.failures.join('; ')).toEqual([]);
  });
});
