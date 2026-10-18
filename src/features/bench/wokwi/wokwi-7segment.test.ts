import { describe, expect, it } from 'vitest';
import { sevenSegmentDefinition, SevenSegment } from '@/features/parts';
import type { PartInstance } from '@/features/simulation';
import type { FootprintState } from './footprints';
import { pushWokwiState } from './wokwi';

/**
 * The Wokwi 7-segment element renders every digit from one flat `values`
 * array, but multiplexed firmware lights a single digit per solve. The bench
 * therefore latches each digit in the engine on every solve and pushes the
 * whole held frame — pushing only the currently-lit digit flickers through
 * one digit at a time and can never observe a strobe reliably.
 */

function bench4(): {
  part: PartInstance;
  controller: SevenSegment;
  state: FootprintState;
} {
  const definition = sevenSegmentDefinition(4);
  const part = { id: 'p1', definition } as PartInstance;
  const controller = new SevenSegment(4);
  const state = {
    pinVolts: new Map<string, number>(),
    displays: new Map([[part.id, controller]]),
  } as unknown as FootprintState;
  return { part, controller, state };
}

/** One multiplex step in solved volts: digit `digit` at 5V, segments for `mask` low. */
function drive(controller: SevenSegment, digit: number, mask: number): void {
  const digitVolts = [0, 0, 0, 0];
  digitVolts[digit - 1] = 5;
  const segVolts = Array.from({ length: 8 }, (_, index) => ((mask >> index) & 1 ? 0 : 5));
  controller.update(digitVolts, segVolts);
}

describe('multiplexed 7-segment frame', () => {
  it('holds every digit after one multiplex cycle', () => {
    const definition = sevenSegmentDefinition(4);
    const { part, controller, state } = bench4();
    const element = {
      digits: 0,
      values: [] as number[],
      colon: false,
      colonValue: false,
      color: '',
      offColor: '',
    } as unknown as HTMLElement;

    // '1' is segments B and C: mask 0x06. Blank the other commons first,
    // the way correct firmware does before moving the segments.
    drive(controller, 1, 0x06);
    pushWokwiState(element, definition, part, state);
    const afterFirst = [...(element as unknown as { values: number[] }).values];
    expect(afterFirst.slice(0, 8)).toEqual([0, 1, 1, 0, 0, 0, 0, 0]);
    expect(afterFirst.slice(8)).toEqual(new Array(24).fill(0));
    const colours = element as unknown as { color: string; offColor: string };
    expect(colours.color).toBe('#ff0000');
    expect(colours.offColor).toBe('#565656');

    drive(controller, 2, 0x5b);
    pushWokwiState(element, definition, part, state);
    // The second digit latches without blanking the first.
    const afterSecond = [...(element as unknown as { values: number[] }).values];
    expect(afterSecond.slice(0, 8)).toEqual([0, 1, 1, 0, 0, 0, 0, 0]);
    expect(afterSecond.slice(8, 16)).toEqual([1, 1, 0, 1, 1, 0, 1, 0]);
  });

  it('drives the colon from COM/CLN, active-low', () => {
    const definition = sevenSegmentDefinition(4);
    const { part, controller, state } = bench4();
    const element = {
      digits: 0,
      values: [] as number[],
      colon: false,
      colonValue: false,
    } as unknown as HTMLElement;

    drive(controller, 1, 0x3f);
    controller.update([5, 0, 0, 0], [0, 0, 0, 0, 0, 0, 5, 5], 5, 0);
    expect(controller.colonLit).toBe(true);
    pushWokwiState(element, definition, part, state);
    const target = element as unknown as { colon: boolean; colonValue: boolean };
    expect(target.colon).toBe(true);
    expect(target.colonValue).toBe(true);

    controller.update([5, 0, 0, 0], [0, 0, 0, 0, 0, 0, 5, 5], 5, 5);
    expect(controller.colonLit).toBe(false);
    pushWokwiState(element, definition, part, state);
    expect(target.colonValue).toBe(false);
  });

  it('leaves the element alone with nothing modeled yet', () => {
    const definition = sevenSegmentDefinition(4);
    const { part, state } = bench4();
    (state.displays as Map<string, unknown>).clear();
    const element = { digits: 0, values: [7] as number[] } as unknown as HTMLElement;
    pushWokwiState(element, definition, part, state);
    expect((element as unknown as { values: number[] }).values).toEqual([7]);
  });

  it('decodes a held digit without re-assertion', () => {
    const controller = new SevenSegment(1);
    // Common-anode static drive: common high, lit segments low.
    controller.update([5], [0, 0, 0, 0, 0, 0, 5, 5]);
    expect(controller.getText()).toBe('0');
    // Segments move under an asserted common: the digit follows.
    controller.update([5], [5, 0, 0, 5, 5, 5, 5, 5]);
    expect(controller.getText()).toBe('1');
  });
});
