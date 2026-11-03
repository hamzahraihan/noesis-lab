/**
 * Fixture registry for the differential harness.
 *
 * Each fixture defines a part, its factory arguments, a sequence of stimuli,
 * and the expected observation labels.
 */
import pcf8574 from './pcf8574.json';
import mcp23017 from './mcp23017.json';
import ads1115 from './ads1115.json';
import shift595 from './shift595.json';
import pcd8544 from './pcd8544.json';
import servo from './servo.json';
import stepper from './stepper.json';
import a4988 from './a4988.json';
import ssd1306 from './ssd1306.json';
import ili9341 from './ili9341.json';
import max7219 from './max7219.json';
import hd44780 from './hd44780.json';
import type { Stimulus } from '../probe';

// The stimulus union has one source: probe.ts. Re-exported so fixtures stay a
// single import for callers.
export type { Stimulus } from '../probe';

export interface Fixture {
  part: string;
  factoryArgs: unknown[];
  stimuli: Stimulus[];
  labels: string[];
  note: string;
}

export const FIXTURE_LIST = [
  pcf8574,
  mcp23017,
  ads1115,
  shift595,
  pcd8544,
  servo,
  stepper,
  a4988,
  ssd1306,
  ili9341,
  max7219,
  hd44780,
] as Fixture[];

// Derive the keyed view from the list so the two cannot drift: the harness runs
// the list and asserts the map matches it.
export const FIXTURES = Object.fromEntries(
  FIXTURE_LIST.map((f) => [f.part, f as Fixture]),
) as Record<string, Fixture>;
