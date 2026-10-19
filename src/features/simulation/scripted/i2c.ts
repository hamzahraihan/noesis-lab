/**
 * The I2C half of the scripting bridge.
 *
 * The sampler answers "what does every part read right now" for the netlist. A
 * slave is asked something else: one question, at one moment, about one part,
 * because that is how the bus asks -- an address, a register pointer and a count
 * -- and the answer has to be bytes rather than a number.
 *
 * The split is the same as the netlist's: the host (the engine) knows the clock
 * and the operator's knobs, this module knows the runtime, and the device on the
 * bench knows neither.
 */

import type { DynamicState } from '@/features/parts';
import { reportFault } from './diagnostics';
import type { ScriptedRuntime } from './runtime';
import { knobValues, type PlacedPart } from './sampler';

/**
 * What a scripted slave answers, as the engine's bus plumbing calls it.
 *
 * Faults are not reported here: a faulted part answers nothing, the bus NACKs,
 * and `reportFault` has already put the one line in the log.
 */
export interface ScriptedI2c {
  read(
    partId: string,
    register: number,
    count: number,
    timeMs: number,
    state: DynamicState,
  ): readonly number[] | null;
  /** False when the slave refused the write, which the bus answers as a NACK. */
  write(
    partId: string,
    register: number,
    bytes: readonly number[],
    timeMs: number,
    state: DynamicState,
  ): boolean;
}

export function createScriptedI2c(
  runtime: ScriptedRuntime,
  parts: () => readonly PlacedPart[],
): ScriptedI2c {
  /** The script and bus of the part that owns an address, if there is one. */
  const partById = (partId: string): PlacedPart | null =>
    parts().find((part) => part.id === partId) ?? null;

  function scriptedOf(partId: string) {
    const part = partById(partId);
    const component = part?.definition.component;
    if (part === null || component?.kind !== 'scripted' || component.bus !== 'i2c') return null;
    const script = part.definition.script;
    if (script === undefined) return null;
    return { id: part.id, script, bus: 'i2c' as const, definition: part.definition };
  }

  return {
    read(partId, register, count, timeMs, state) {
      const part = scriptedOf(partId);
      if (part === null) return null;
      const answer = runtime.readI2c(
        { id: part.id, script: part.script, bus: part.bus },
        register,
        count,
        timeMs,
        knobValues(part.definition, part.id, state),
      );
      if (answer.fault !== null) {
        reportFault(part.id, answer.fault);
        return null;
      }
      return answer.bytes;
    },

    write(partId, register, bytes, timeMs, state) {
      const part = scriptedOf(partId);
      if (part === null) return false;
      const answer = runtime.writeI2c(
        { id: part.id, script: part.script, bus: part.bus },
        register,
        bytes,
        timeMs,
        knobValues(part.definition, part.id, state),
      );
      if (answer.fault !== null) reportFault(part.id, answer.fault);
      return answer.ok;
    },
  };
}
