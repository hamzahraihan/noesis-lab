import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadCiProject } from './project';
import { runCiProject } from './runner';

/** The example project the documentation points at. */
const EXAMPLE = fileURLToPath(new URL('../../../../examples/ci/blink', import.meta.url));

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
      expectations: { frames: 60, serial: ['never said this'] },
    });
    expect(run.failures.join('; ')).toContain('never said this');
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
