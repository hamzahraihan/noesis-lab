/**
 * Hardware assertions for a CI project.
 *
 * A project's serial output says what the sketch printed; these say what the
 * bench itself did. A pin driven high, a current drawn through it, a character
 * on an LCD, a pixel lit on a panel, a shaft that stopped between full steps:
 * each is a reading the simulation already has, and each is something a sketch
 * can get wrong while printing the right lines.
 *
 * The file is data, so a project can declare an assertion without writing a
 * test, and the runner can check it without a browser.
 */

/** The fields every assertion carries. */
interface AssertionBase {
  /** A name a failure can use instead of the default. */
  readonly name?: string;
  /** The frame to read, counted from one. Defaults to the last frame. */
  readonly at?: number;
}

/** A part pin's voltage, in volts. */
export interface VoltsAssertion extends AssertionBase {
  readonly kind: 'volts';
  readonly part: string;
  readonly pin: string;
  readonly min?: number;
  readonly max?: number;
}

/** The current a board pin is sourcing, in amps. */
export interface AmpsAssertion extends AssertionBase {
  readonly kind: 'amps';
  readonly pin: string;
  readonly min?: number;
  readonly max?: number;
}

/** What a character LCD is showing. */
export interface TextAssertion extends AssertionBase {
  readonly kind: 'text';
  readonly part: string;
  readonly contains: string;
}

/** One pixel on a monochrome display. */
export interface PixelAssertion extends AssertionBase {
  readonly kind: 'pixel';
  readonly part: string;
  readonly x: number;
  readonly y: number;
  readonly on: boolean;
}

/** A stepper's shaft angle, against the angle the project expects. */
export interface AngleAssertion extends AssertionBase {
  readonly kind: 'angle';
  readonly part: string;
  readonly degrees: number;
  readonly tolerance?: number;
}

export type HardwareAssertion =
  | VoltsAssertion
  | AmpsAssertion
  | TextAssertion
  | PixelAssertion
  | AngleAssertion;

/** What a bench can answer, at one instant. `undefined` means "not that part". */
export interface HardwareSnapshot {
  volts(part: string, pin: string): number | undefined;
  amps(pin: string): number | undefined;
  text(part: string): string | undefined;
  pixel(part: string, x: number, y: number): boolean | undefined;
  angle(part: string): number | undefined;
}

/** One assertion's verdict. */
export interface AssertionResult {
  readonly ok: boolean;
  readonly name: string;
  readonly detail: string;
}

/** The tolerance an angle assertion gets when it does not name one. */
export const DEFAULT_ANGLE_TOLERANCE = 0.5;

/**
 * Reads the assertions from `expect.json`.
 *
 * Every failure names the file and the entry, because the file is somebody
 * else's repository and a CI log that says "invalid" is a log nobody can act
 * on. `frames` bounds `at`, so an assertion cannot wait past the run.
 */
export function parseHardwareAssertions(
  raw: unknown,
  frames: number,
  label = 'expect.json',
): HardwareAssertion[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${label}: hardware must be a list`);
  return raw.map((entry, index) => parseOne(entry, index, frames, label));
}

function parseOne(entry: unknown, index: number, frames: number, label: string): HardwareAssertion {
  const where = `${label}: hardware[${index}]`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`${where}: expected an object`);
  }
  const record = entry as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== 'string') {
    throw new Error(`${where}: kind must be a string`);
  }

  const common: { name?: string; at?: number } = {};
  if (record.name !== undefined) {
    if (typeof record.name !== 'string' || record.name.trim() === '') {
      throw new Error(`${where}: name must be a non-empty string`);
    }
    common.name = record.name;
  }
  if (record.at !== undefined) {
    const at = record.at;
    if (typeof at !== 'number' || !Number.isInteger(at)) {
      throw new Error(`${where}: at must be a whole frame number`);
    }
    if (at < 1 || at > frames) {
      throw new Error(`${where}: at must be between 1 and ${frames}`);
    }
    common.at = at;
  }

  switch (kind) {
    case 'volts': {
      const min = optionalNumber(record.min, `${where}: min`);
      const max = optionalNumber(record.max, `${where}: max`);
      requireBounds(min, max, where, 'volts');
      return {
        ...common,
        kind,
        part: requiredString(record.part, `${where}: part`),
        pin: requiredString(record.pin, `${where}: pin`),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
    }
    case 'amps': {
      const min = optionalNumber(record.min, `${where}: min`);
      const max = optionalNumber(record.max, `${where}: max`);
      requireBounds(min, max, where, 'amps');
      return {
        ...common,
        kind,
        pin: requiredString(record.pin, `${where}: pin`),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
    }
    case 'text':
      return {
        ...common,
        kind,
        part: requiredString(record.part, `${where}: part`),
        contains: requiredString(record.contains, `${where}: contains`),
      };
    case 'pixel': {
      const x = wholeNumber(record.x, `${where}: x`);
      const y = wholeNumber(record.y, `${where}: y`);
      if (typeof record.on !== 'boolean') {
        throw new Error(`${where}: on must be true or false`);
      }
      return {
        ...common,
        kind,
        part: requiredString(record.part, `${where}: part`),
        x,
        y,
        on: record.on,
      };
    }
    case 'angle': {
      const degrees = optionalNumber(record.degrees, `${where}: degrees`);
      if (degrees === undefined) throw new Error(`${where}: degrees must be a number`);
      const tolerance = optionalNumber(record.tolerance, `${where}: tolerance`);
      if (tolerance !== undefined && tolerance < 0) {
        throw new Error(`${where}: tolerance must not be negative`);
      }
      return {
        ...common,
        kind,
        part: requiredString(record.part, `${where}: part`),
        degrees,
        ...(tolerance !== undefined ? { tolerance } : {}),
      };
    }
    default:
      throw new Error(`${where}: kind must be one of volts, amps, text, pixel, angle`);
  }
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where} must be a non-empty string`);
  }
  return value;
}

function optionalNumber(value: unknown, where: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where} must be a number`);
  }
  return value;
}

function wholeNumber(value: unknown, where: string): number {
  const number = optionalNumber(value, where);
  if (number === undefined || !Number.isInteger(number) || number < 0) {
    throw new Error(`${where} must be a whole number`);
  }
  return number;
}

function requireBounds(
  min: number | undefined,
  max: number | undefined,
  where: string,
  kind: string,
): void {
  if (min === undefined && max === undefined) {
    throw new Error(`${where}: ${kind} needs min, max, or both`);
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`${where}: min must not be more than max`);
  }
}

/**
 * The verdict for one assertion.
 *
 * The snapshot answers `undefined` when the part cannot answer at all — a pin
 * that is not on the circuit, a part that is not a display — which is a
 * different failure from a reading that is merely wrong, and says so.
 */
export function checkHardware(
  assertion: HardwareAssertion,
  snapshot: HardwareSnapshot,
): AssertionResult {
  const name = assertion.name ?? defaultName(assertion);
  switch (assertion.kind) {
    case 'volts': {
      const actual = snapshot.volts(assertion.part, assertion.pin);
      if (actual === undefined) {
        return miss(name, `${assertion.part}:${assertion.pin} is not a pin on the circuit`);
      }
      return bounds(
        name,
        actual,
        assertion.min,
        assertion.max,
        'V',
        `${assertion.part}:${assertion.pin}`,
      );
    }
    case 'amps': {
      const actual = snapshot.amps(assertion.pin);
      if (actual === undefined) {
        return miss(name, `${assertion.pin} is not a pin on the board`);
      }
      return bounds(name, actual, assertion.min, assertion.max, 'A', assertion.pin);
    }
    case 'text': {
      const actual = snapshot.text(assertion.part);
      if (actual === undefined) {
        return miss(name, `${assertion.part} is not a character LCD`);
      }
      if (actual.includes(assertion.contains)) return pass(name);
      return miss(
        name,
        `expected ${assertion.part} to contain ${JSON.stringify(assertion.contains)}, saw ${JSON.stringify(actual)}`,
      );
    }
    case 'pixel': {
      const actual = snapshot.pixel(assertion.part, assertion.x, assertion.y);
      if (actual === undefined) {
        return miss(name, `${assertion.part} is not a display this can read`);
      }
      if (actual === assertion.on) return pass(name);
      return miss(
        name,
        `expected pixel (${assertion.x},${assertion.y}) on ${assertion.part} to be ${assertion.on ? 'on' : 'off'}, saw ${actual ? 'on' : 'off'}`,
      );
    }
    case 'angle': {
      const actual = snapshot.angle(assertion.part);
      if (actual === undefined) {
        return miss(name, `${assertion.part} is not a stepper`);
      }
      const tolerance = assertion.tolerance ?? DEFAULT_ANGLE_TOLERANCE;
      if (Math.abs(actual - assertion.degrees) <= tolerance) return pass(name);
      return miss(
        name,
        `expected ${assertion.part} at ${number(assertion.degrees)} ± ${number(tolerance)}°, saw ${number(actual)}°`,
      );
    }
  }
}

function pass(name: string): AssertionResult {
  return { ok: true, name, detail: '' };
}

function miss(name: string, detail: string): AssertionResult {
  return { ok: false, name, detail };
}

function bounds(
  name: string,
  actual: number,
  min: number | undefined,
  max: number | undefined,
  unit: string,
  point: string,
): AssertionResult {
  if (min !== undefined && max !== undefined && actual >= min && actual <= max) {
    return pass(name);
  }
  if (min !== undefined && max === undefined && actual >= min) return pass(name);
  if (min === undefined && max !== undefined && actual <= max) return pass(name);
  if (min !== undefined && max !== undefined) {
    return miss(
      name,
      `expected ${number(min)} to ${number(max)} ${unit} on ${point}, saw ${number(actual)} ${unit}`,
    );
  }
  if (min !== undefined) {
    return miss(
      name,
      `expected at least ${number(min)} ${unit} on ${point}, saw ${number(actual)} ${unit}`,
    );
  }
  return miss(
    name,
    `expected at most ${number(max ?? 0)} ${unit} on ${point}, saw ${number(actual)} ${unit}`,
  );
}

/** A number short enough for a CI line, without trailing zeros. */
function number(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function defaultName(assertion: HardwareAssertion): string {
  switch (assertion.kind) {
    case 'volts':
      return `volts ${assertion.part}:${assertion.pin}`;
    case 'amps':
      return `amps ${assertion.pin}`;
    case 'text':
      return `text ${assertion.part}`;
    case 'pixel':
      return `pixel ${assertion.part} (${assertion.x},${assertion.y})`;
    case 'angle':
      return `angle ${assertion.part}`;
  }
}
