import { describe, expect, it } from 'vitest';
import { benchBounds } from './bounds';
import type { Bench, PartInstance, Terminal, Wire } from '@/features/simulation';

/** A part with only the fields the bounds need. */
function part(x: number, y: number, widthMm: number, heightMm: number, rotation = 0): PartInstance {
  return {
    id: `p${x}.${y}`,
    x,
    y,
    rotation,
    definition: { widthMm, heightMm },
  } as unknown as PartInstance;
}

function bench(parts: PartInstance[], terminals: Terminal[] = [], wires: Wire[] = []): Bench {
  return { parts, terminals, wires, revision: 0 } as unknown as Bench;
}

describe('bench bounds', () => {
  it('is null when there is nothing on the bench', () => {
    expect(benchBounds(bench([]))).toBeNull();
  });

  it('spans a part body, and reads a quarter turn as a swapped box', () => {
    expect(benchBounds(bench([part(10, 5, 40, 20)]))).toEqual({
      x: 10,
      y: 5,
      width: 40,
      height: 20,
    });
    // The same board turned a quarter turn occupies 20 wide and 40 tall.
    expect(benchBounds(bench([part(10, 5, 40, 20, 90)]))).toEqual({
      x: 10,
      y: 5,
      width: 20,
      height: 40,
    });
  });

  it('includes a terminal that stands off its part body', () => {
    const terminal = { id: 1, x: 80, y: 60 } as Terminal;
    expect(benchBounds(bench([part(0, 0, 10, 10)], [terminal]))).toEqual({
      x: 0,
      y: 0,
      width: 80,
      height: 60,
    });
  });

  it('includes the bends a jumper was routed around', () => {
    const wire = { id: 'w', from: 0, to: 1, bends: [{ x: -5, y: 30 }] } as unknown as Wire;
    expect(benchBounds(bench([part(0, 0, 10, 10)], [], [wire]))).toEqual({
      x: -5,
      y: 0,
      width: 15,
      height: 30,
    });
  });
});
