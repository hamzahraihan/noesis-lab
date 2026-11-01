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

export interface Fixture {
  part: string;
  factoryArgs: unknown[];
  stimuli: Stimulus[];
  labels: string[];
  note: string;
}

export type Stimulus =
  | { kind: 'i2c-write'; address: number; bytes: number[] }
  | { kind: 'i2c-read'; address: number; count: number }
  | { kind: 'spi-transfer'; byte: number; dc: boolean; cs: boolean }
  | { kind: 'pin'; index: number; high: boolean }
  | { kind: 'knob'; name: string; value: number };

export const FIXTURES: Record<string, Fixture> = {
  pcf8574: pcf8574 as Fixture,
  mcp23017: mcp23017 as Fixture,
  ads1115: ads1115 as Fixture,
  shift595: shift595 as Fixture,
  pcd8544: pcd8544 as Fixture,
};

export const FIXTURE_LIST = [pcf8574, mcp23017, ads1115, shift595, pcd8544] as Fixture[];