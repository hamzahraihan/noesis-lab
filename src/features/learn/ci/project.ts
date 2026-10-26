/**
 * A project a CI run can check: a circuit, a sketch, and what the run should
 * see.
 *
 * The bench's own gallery projects carry a circuit and a sketch, but they live
 * in the app's own catalogue and are checked by the app's own tests. A user
 * wants the same thing for *their* project, on *their* repository, on every
 * push: a folder the CI can read, run, and say something definite about.
 *
 * So a CI project is three files in a folder:
 *
 * - `circuit.json` -- the circuit document, in the form the bench saves ✓
 * - `main.ino` or `main.py` -- the sketch, in the board's language ✓
 * - `expect.json` -- what the run should see ✓
 *
 * Nothing here imports the app: a project is data, and the runner reads it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCircuit, type CircuitDocument } from '@/features/simulation';
import type { FirmwareProject } from '@/features/simulation';
import { boardForCircuit, type BoardOption } from '../boardRegistry';
import { parseHardwareAssertions, type HardwareAssertion } from './assertions';

/** What a run should see. */
export interface CiExpectations {
  /**
   * How many frames to run.
   *
   * A frame is a sixtieth of a second of simulated time, which is what the
   * bench's own animation loop spends per frame, so a project that takes two
   * seconds to show something needs about a hundred and twenty.
   */
  readonly frames: number;
  /**
   * Lines the serial output has to carry, in order.
   *
   * In order rather than exactly: a sketch that logs more than this is still
   * running the way the project meant it to, and a check that failed on the
   * extra lines would be a nuisance rather than a truth.
   */
  readonly serial: readonly string[];
  /**
   * What the bench itself should be doing.
   *
   * Optional in the file, empty when the project only checks serial output.
   */
  readonly hardware: readonly HardwareAssertion[];
}

/** A project, read from its folder. */
export interface CiProject {
  readonly circuit: CircuitDocument;
  readonly firmware: FirmwareProject;
  readonly expectations: CiExpectations;
  /** The board the circuit is for, which the sketch's language follows. */
  readonly board: BoardOption;
}

/** The frames a run takes when the project does not say. */
export const DEFAULT_CI_FRAMES = 120;

/**
 * Reads a project folder.
 *
 * Every failure names the file it came from, because the folder is somebody's
 * repository and a CI log that says "invalid" and nothing else is a log
 * nobody can act on.
 */
export function loadCiProject(folder: string): CiProject {
  const circuitText = readFile(join(folder, 'circuit.json'), 'circuit.json');
  let circuitRaw: unknown;
  try {
    circuitRaw = JSON.parse(circuitText);
  } catch (error) {
    throw new Error(`circuit.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const circuit = parseCircuit(circuitRaw, 'circuit.json');
  const board = boardForCircuit(circuit);
  const language = board.language;
  const entry = language === 'python' ? 'main.py' : 'main.ino';
  const sketch = readFile(join(folder, entry), entry);
  const expectations = readExpectations(folder);
  return {
    circuit,
    board,
    expectations,
    firmware: {
      language,
      files: [{ name: entry, content: sketch }],
      activeName: entry,
    },
  };
}

/** Reads the expectations, or the defaults when the folder has none. */
function readExpectations(folder: string): CiExpectations {
  let raw: string;
  try {
    raw = readFileSync(join(folder, 'expect.json'), 'utf8');
  } catch {
    return { frames: DEFAULT_CI_FRAMES, serial: [], hardware: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`expect.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('expect.json: expected an object');
  }
  const record = parsed as Record<string, unknown>;
  const frames = record.frames;
  if (
    frames !== undefined &&
    (typeof frames !== 'number' || !Number.isFinite(frames) || frames < 0)
  ) {
    throw new Error('expect.json: frames must be a number of frames');
  }
  const serial = record.serial;
  if (
    serial !== undefined &&
    (!Array.isArray(serial) || serial.some((line) => typeof line !== 'string'))
  ) {
    throw new Error('expect.json: serial must be a list of lines');
  }
  const framesCount = typeof frames === 'number' ? Math.floor(frames) : DEFAULT_CI_FRAMES;
  return {
    frames: framesCount,
    serial: Array.isArray(serial) ? (serial as string[]) : [],
    hardware: parseHardwareAssertions(record.hardware, framesCount),
  };
}

/** Reads a file, naming it when it is not there. */
function readFile(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`${label}: not found`);
  }
}
