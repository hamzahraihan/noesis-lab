/**
 * Adapter registry for the differential harness.
 *
 * Maps part kind strings to their adapters. Import this to get the ADAPTERS map.
 */
import { pcf8574Adapter } from './pcf8574';
import { mcp23017Adapter } from './mcp23017';
import { ads1115Adapter } from './ads1115';
import { shift595Adapter } from './shift595';
import type { PartAdapter } from './probe';

export const ADAPTERS: Record<string, PartAdapter> = {
  pcf8574: pcf8574Adapter,
  mcp23017: mcp23017Adapter,
  ads1115: ads1115Adapter,
  shift595: shift595Adapter,
};

export * from './pcf8574';
export * from './mcp23017';
export * from './ads1115';
export * from './shift595';