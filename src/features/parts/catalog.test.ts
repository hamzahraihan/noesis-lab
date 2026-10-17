import { describe, expect, it } from 'vitest';
import { DynamicState, partDefinitionById } from '@/features/parts';

describe('partDefinitionById', () => {
  it('returns a definition whose id matches the requested id', () => {
    const def = partDefinitionById('arduino-uno-r3');
    expect(def).toBeDefined();
    expect(def!.id).toBe('arduino-uno-r3');
  });

  it('returns undefined for an unknown id', () => {
    expect(partDefinitionById('no-such-part')).toBeUndefined();
  });
});

describe('DynamicState#entries', () => {
  it('returns a copy of the knob values', () => {
    const state = new DynamicState();
    const spec = { id: 'turn', label: 'w', min: 0, max: 1, step: 0.1, defaultValue: 0.25 } as any;
    state.setKnob('p1', spec, 0.5);
    const entries = state.entries();
    expect(entries.get('p1:turn')).toBe(0.5);
    state.setKnob('p1', spec, 0.9);
    expect(entries.get('p1:turn')).toBe(0.5);
  });

  it('copyValuesFrom copies knob values from another state', () => {
    const a = new DynamicState();
    const b = new DynamicState();
    const spec = { id: 'turn', label: 'w', min: 0, max: 1, step: 0.1, defaultValue: 0.25 } as any;
    a.setKnob('p1', spec, 0.7);
    b.copyValuesFrom(a);
    expect(b.entries().get('p1:turn')).toBe(0.7);
  });
});
