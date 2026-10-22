/**
 * Running a project without a browser.
 *
 * The bench is a page, but the simulation underneath it is plain TypeScript: a
 * circuit, a sketch, and a clock. That is what makes a CI run possible -- the
 * same simulation the app drives, run headlessly, answering the question a
 * project asks of it.
 *
 * The sketch runs on the interpreter, because that is the path a machine
 * without a browser can run: the compiled path needs a HEX built by a
 * toolchain the CI would have to fetch.
 */

import { Simulation } from '@/features/bench';
import type { CiProject } from './project';

/** What a run saw. */
export interface CiRun {
  /** The frames the run took. */
  readonly frames: number;
  /** The serial output, line by line. */
  readonly serial: readonly string[];
  /** What went wrong, if anything did. */
  readonly failures: readonly string[];
}

/**
 * Runs a project and says what it saw.
 *
 * The failures are what a CI log should print: a line that was never said, a
 * sketch that would not compile, a circuit that would not build. An empty
 * list means the run matched what the project expected.
 */
export function runCiProject(project: CiProject): CiRun {
  const simulation = new Simulation(project.board.make());
  const errors = simulation.loadCircuit(project.circuit);
  if (errors.length > 0) {
    return { frames: 0, serial: [], failures: errors };
  }
  simulation.execution = 'interpreter';
  simulation.loadFirmware(project.firmware);
  if (simulation.firmwareError !== null) {
    return { frames: 0, serial: [], failures: [simulation.firmwareError] };
  }
  simulation.start();
  for (let frame = 0; frame < project.expectations.frames; frame++) {
    // A frame is a sixtieth of a second, which is what the bench's own
    // animation loop spends on one.
    simulation.tick(1 / 60);
  }
  const serial = simulation.serialLines();
  return {
    frames: project.expectations.frames,
    serial,
    failures: checkSerial(serial, project.expectations.serial),
  };
}

/**
 * The expectations the serial output did not meet.
 *
 * In order rather than exactly: a sketch that logs more than the project
 * expects is still running the way the project meant it to, and a check that
 * failed on the extra lines would be a nuisance rather than a truth.
 */
function checkSerial(lines: readonly string[], expected: readonly string[]): string[] {
  const failures: string[] = [];
  let from = 0;
  for (const wanted of expected) {
    const at = lines.slice(from).findIndex((line) => line.includes(wanted));
    if (at < 0) {
      failures.push(`the serial output never said ${JSON.stringify(wanted)}`);
      continue;
    }
    from += at + 1;
  }
  return failures;
}
