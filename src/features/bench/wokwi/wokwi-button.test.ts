import { describe, expect, it } from 'vitest';
import { buttonDefinition, DynamicState } from '@/features/parts';
import type { PartInstance } from '@/features/simulation';
import type { FootprintState } from './footprints';
import { pushWokwiState } from './wokwi';

function buttonState(): { part: PartInstance; state: FootprintState } {
  const part = {
    id: 'p1',
    definition: buttonDefinition(),
    capColour: '#22c55e',
  } as PartInstance;
  const state = {
    pinVolts: new Map<string, number>(),
    controls: new DynamicState(),
  } as unknown as FootprintState;
  return { part, state };
}

describe('pushbutton cap colour', () => {
  it('pushes the instance cap colour to the element', () => {
    const { part, state } = buttonState();
    const element = { pressed: false, color: '' } as unknown as HTMLElement;
    pushWokwiState(element, part.definition, part, state);
    const target = element as unknown as { pressed: boolean; color: string };
    expect(target.pressed).toBe(false);
    expect(target.color).toBe('#22c55e');
  });

  it('leaves the element default alone when unpainted', () => {
    const { part, state } = buttonState();
    delete part.capColour;
    const element = { pressed: false, color: 'red' } as unknown as HTMLElement;
    pushWokwiState(element, part.definition, part, state);
    expect((element as unknown as { color: string }).color).toBe('red');
  });
});
