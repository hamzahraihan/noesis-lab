/**
 * Who asks the scripts, and when.
 *
 * The runtime (`runtime.ts`) answers one part at a time; the netlist wants every
 * part's reading at once, as a map it can read while it builds. This is that
 * translation, plus the rule the cost measured: **the call is cheap (11 us), the
 * netlist rebuild it triggers is not**, so the sampler's cadence exists to bound
 * rebuilds rather than calls.
 *
 * It is a plain function of the bench and the operator's state, so the engine can
 * hold it without knowing what a script is, and both backends can install the
 * same one.
 */

import type { DynamicState, PartDefinition } from '@/features/parts';
import { reportFault } from './diagnostics';
import type { ScriptedRuntime } from './runtime';

/**
 * Every scripted part's reading at a time, or a map with fewer entries when a
 * part has faulted (its absence is the safe state the netlist reads as zero).
 */
export type ScriptedSampler = (timeMs: number, state: DynamicState) => ReadonlyMap<string, number>;

/**
 * How often the scripts are asked, in simulated milliseconds.
 *
 * A sensor is slow; ten milliseconds is a hundred samples a second, which is
 * already more than an analog reading changes in the lessons that use them. The
 * engine rebuilds only when the answer *changed*, so this bounds the rebuild
 * rate and not the script's CPU.
 */
export const SCRIPTED_SAMPLE_MS = 10;

/**
 * The knobs a part declares, with the values the operator currently holds.
 *
 * Shared with the I2C half, which asks scripts for the same thing at a different
 * moment: one rule about what a knob means, expressed once.
 */
export function knobValues(
  definition: PartDefinition,
  partId: string,
  state: DynamicState,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const knob of definition.knobs ?? []) values[knob.id] = state.knob(partId, knob);
  return values;
}

/**
 * The slice of a placed part this needs: its id and its definition. Typed
 * structurally so the sampler does not reach across features for `PartInstance`.
 */
export interface PlacedPart {
  readonly id: string;
  readonly definition: PartDefinition;
}

export function createScriptedSampler(
  runtime: ScriptedRuntime,
  parts: () => readonly PlacedPart[],
): ScriptedSampler {
  return (timeMs, state) => {
    const values = new Map<string, number>();
    for (const part of parts()) {
      const component = part.definition.component;
      if (component.kind !== 'scripted') continue;
      const script = part.definition.script;
      if (script === undefined) continue;
      const reading = runtime.read(
        { id: part.id, script, bus: component.bus },
        timeMs,
        knobValues(part.definition, part.id, state),
      );
      if (reading.fault !== null) reportFault(part.id, reading.fault);
      if (reading.value !== undefined) values.set(part.id, reading.value);
    }
    return values;
  };
}
