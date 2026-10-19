import { describe, expect, it } from 'vitest';
import { BenchBuilder } from '../bench';
import { NO_DYNAMIC_STATE, type DynamicState } from '@/features/parts';
import type { PartDefinition } from '@/features/parts';
import { createScriptedSampler, SCRIPTED_SAMPLE_MS } from './sampler';
import type { ScriptedRuntime } from './runtime';

/**
 * The sampler alone: the translation between "what does this part say" and the
 * map the netlist reads, with a stub in place of QuickJS.
 */
const probe = (id: string, extra: Partial<PartDefinition> = {}): PartDefinition => ({
  id,
  name: 'Scripted probe',
  category: 'input',
  widthMm: 20,
  heightMm: 12,
  bodyColour: '#5b6b4a',
  legendColour: '#f2f2ee',
  component: { kind: 'scripted', bus: 'analog' },
  script: '({ analog: () => 0.5 })',
  pins: [
    { id: 'AOUT', label: 'OUT', x: 0, y: 6 },
    { id: 'VCC', label: 'VCC', x: 10, y: 6 },
    { id: 'GND', label: 'GND', x: 20, y: 6 },
  ],
  ...extra,
});

describe('the scripted sampler', () => {
  it('asks every scripted part and nothing else', () => {
    const builder = new BenchBuilder();
    const probeA = builder.addPart(probe('probe-a'), 0, 0);
    const probeB = builder.addPart(probe('probe-b'), 40, 0);
    builder.addPart(
      {
        ...probe('plain-resistor'),
        component: { kind: 'resistor', ohms: 1_000 },
        script: undefined,
      },
      80,
      0,
    );
    const asked: string[] = [];
    const runtime: ScriptedRuntime = {
      read: (part) => {
        asked.push(part.id);
        return { value: part.id === probeA.id ? 0.25 : 0.75, fault: null };
      },
      dispose: () => undefined,
    };

    const sample = createScriptedSampler(runtime, () => [probeA, probeB]);
    const values = sample(0, NO_DYNAMIC_STATE);

    // The bench gives the parts their own ids, which is what everything else
    // keys on -- the sampler included.
    expect(asked).toEqual([probeA.id, probeB.id]);
    expect([...values]).toEqual([
      [probeA.id, 0.25],
      [probeB.id, 0.75],
    ]);
  });

  it('leaves a faulted part out of the map, which the netlist reads as zero', () => {
    const builder = new BenchBuilder();
    const part = builder.addPart(probe('broken'), 0, 0);
    const runtime: ScriptedRuntime = {
      read: () => ({ value: undefined, fault: 'Error: no sensor' }),
      dispose: () => undefined,
    };

    const values = createScriptedSampler(runtime, () => [part])(0, NO_DYNAMIC_STATE);
    expect(values.size).toBe(0);
  });

  it('hands the script the knobs the operator holds', () => {
    const builder = new BenchBuilder();
    const part = builder.addPart(
      probe('knobbed', {
        knobs: [
          { id: 'moisture', label: 'Moisture', min: 0, max: 100, step: 1, defaultValue: 40 },
        ],
      }),
      0,
      0,
    );
    let seen: Readonly<Record<string, number>> = {};
    const runtime: ScriptedRuntime = {
      read: (_part, _timeMs, knobs) => {
        seen = knobs;
        return { value: 0.5, fault: null };
      },
      dispose: () => undefined,
    };

    // The knob's own default is what a part reports before anyone turns it.
    createScriptedSampler(runtime, () => [part])(0, NO_DYNAMIC_STATE);
    expect(seen.moisture).toBe(40);
    expect(SCRIPTED_SAMPLE_MS).toBe(10);
  });

  it('passes the simulated time through, not the wall clock', () => {
    const builder = new BenchBuilder();
    const part = builder.addPart(probe('timed'), 0, 0);
    let at = -1;
    const runtime: ScriptedRuntime = {
      read: (_part, timeMs) => {
        at = timeMs;
        return { value: 0.5, fault: null };
      },
      dispose: () => undefined,
    };

    createScriptedSampler(runtime, () => [part])(12_345, {} as DynamicState);
    expect(at).toBe(12_345);
  });
});
