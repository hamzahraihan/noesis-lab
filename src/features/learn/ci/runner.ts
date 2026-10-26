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
import { resolvePin } from '@/features/simulation';
import {
  checkHardware,
  type AssertionResult,
  type HardwareAssertion,
  type HardwareSnapshot,
} from './assertions';
import type { CiExpectations, CiProject } from './project';

/** One hardware assertion's verdict, and the frame it read. */
export interface HardwareReading extends AssertionResult {
  readonly at: number;
}

/** What a run saw. */
export interface CiRun {
  /** The frames the run took. */
  readonly frames: number;
  /** The serial output, line by line. */
  readonly serial: readonly string[];
  /** Every hardware assertion, in the order the project declared them. */
  readonly hardware: readonly HardwareReading[];
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
    return { frames: 0, serial: [], hardware: [], failures: errors };
  }
  simulation.execution = 'interpreter';
  simulation.loadFirmware(project.firmware);
  if (simulation.firmwareError !== null) {
    return { frames: 0, serial: [], hardware: [], failures: [simulation.firmwareError] };
  }
  simulation.start();
  const hardware = sampleHardware(simulation, project.expectations);
  const serial = simulation.serialLines();
  const failures = [
    ...checkSerial(serial, project.expectations.serial),
    ...hardware
      .filter((reading) => !reading.ok)
      .map((reading) => `${reading.name}: ${reading.detail}`),
  ];
  return {
    frames: project.expectations.frames,
    serial,
    hardware,
    failures,
  };
}

/**
 * Reads every hardware assertion at the frame it names.
 *
 * The run advances once, frame by frame, and each assertion samples the state
 * it would have seen live. Defaults to the final frame, which is what a project
 * means when it does not say otherwise.
 */
function sampleHardware(simulation: Simulation, expectations: CiExpectations): HardwareReading[] {
  const snapshot = snapshotOf(simulation);
  const byFrame = new Map<number, { assertion: HardwareAssertion; index: number }[]>();
  expectations.hardware.forEach((assertion, index) => {
    const at = assertion.at ?? expectations.frames;
    const due = byFrame.get(at) ?? [];
    due.push({ assertion, index });
    byFrame.set(at, due);
  });

  const readings: HardwareReading[] = [];
  for (let frame = 0; frame <= expectations.frames; frame++) {
    // A frame is a sixtieth of a second, which is what the bench's own
    // animation loop spends on one.
    if (frame > 0) simulation.tick(1 / 60);
    for (const { assertion, index } of byFrame.get(frame) ?? []) {
      readings[index] = { at: frame, ...checkHardware(assertion, snapshot) };
    }
  }
  return readings.filter((reading): reading is HardwareReading => reading !== undefined);
}

/** The bench, read the way an assertion asks. */
function snapshotOf(simulation: Simulation): HardwareSnapshot {
  return {
    volts(part, pin) {
      const found = simulation.bench.parts.find((candidate) => candidate.id === part);
      if (!found) return undefined;
      const resolved = resolvePin(found.definition, pin);
      if (!resolved) return undefined;
      const net = simulation.engine.currentNetlist.pinNode.get(`${part}:${resolved.id}`);
      return net === undefined ? undefined : simulation.engine.voltageOfNet(net);
    },
    amps(pin) {
      const matches = simulation.mcu
        .pins()
        .filter(
          (candidate) =>
            candidate.id === pin ||
            candidate.id.split('_').pop() === pin ||
            candidate.label === pin,
        );
      // An ambiguous name (several grounds, say) is not a pin to read.
      if (matches.length !== 1) return undefined;
      // A load can pull the pin up or down; an assertion asks how much current
      // flows, not which way the source happens to be counted.
      return Math.abs(simulation.engine.pinCurrentAmps(matches[0].id));
    },
    text(part) {
      return simulation.engine.lcd(part)?.text();
    },
    pixel(part, x, y) {
      const controller = simulation.engine.displayController(part);
      if (!controller) return undefined;
      if ('isLit' in controller) return controller.isLit(x, y);
      if ('pixelAt' in controller) return controller.pixelAt(x, y) !== 0;
      return undefined;
    },
    angle(part) {
      const found = simulation.bench.parts.find((candidate) => candidate.id === part);
      if (found?.definition.component.kind !== 'stepper') return undefined;
      return simulation.engine.stepperAngle(part);
    },
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
