/**
 * Parity gate for issue #20 phase 1: the C++ MNA solver against the
 * TypeScript oracle in `../circuit.ts`.
 *
 * The wasm artifact is a committed build output (`npm run build:engine`), so
 * this test needs no compiler. Every case asserts bit-identical voltages,
 * branch currents, convergence and iteration counts, not just "close enough":
 * the C++ core evaluates the same operations in the same order and imports the
 * host's `Math.exp` / `Math.log1p` for the diode curve, which is what makes
 * exact equality a meaningful gate rather than a tolerance to tune.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { DIODE_PROFILES } from '@/features/parts';
import { elementCurrent, solveCircuit, type Solution, type SolveOptions } from '../circuit';
import { GROUND, type DiodeProfile, type Element } from '../elements';
import { loadWasmSolver, type WasmSolver } from './solver';

let wasm: WasmSolver;

beforeAll(async () => {
  const buffer = readFileSync('src/features/simulation/engine-wasm/solver.wasm');
  const bytes = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  wasm = await loadWasmSolver(async () => bytes);
});

function expectSameSolution(actual: Solution, expected: Solution, context: string): void {
  expect(actual.converged, `${context}: converged`).toBe(expected.converged);
  expect(actual.iterations, `${context}: iterations`).toBe(expected.iterations);
  expect(actual.voltages.length, `${context}: voltage count`).toBe(expected.voltages.length);
  expect(actual.sourceCurrents.length, `${context}: source count`).toBe(
    expected.sourceCurrents.length,
  );
  for (let i = 0; i < expected.voltages.length; i++) {
    expect(actual.voltages[i], `${context}: voltages[${i}]`).toBe(expected.voltages[i]);
  }
  for (let i = 0; i < expected.sourceCurrents.length; i++) {
    expect(actual.sourceCurrents[i], `${context}: sourceCurrents[${i}]`).toBe(
      expected.sourceCurrents[i],
    );
  }
}

function compare(elements: Element[], options: SolveOptions, context: string): Solution {
  const oracle = solveCircuit(elements, options);
  const port = wasm.solve(elements, options);
  expectSameSolution(port, oracle, context);
  for (let i = 0; i < elements.length; i++) {
    expect(wasm.elementCurrent(i, elements, port), `${context}: elementCurrent[${i}]`).toBe(
      elementCurrent(elements[i], oracle),
    );
  }
  return port;
}

function ledCircuit(
  supply: number,
  seriesOhms: number,
  profile: DiodeProfile,
  reversed = false,
): Element[] {
  return [
    { kind: 'voltageSource', a: 0, b: GROUND, volts: supply },
    { kind: 'resistor', a: 0, b: 1, ohms: seriesOhms },
    {
      kind: 'diode',
      a: reversed ? GROUND : 1,
      b: reversed ? 1 : GROUND,
      profile,
    },
  ];
}

describe('C++ solver parity: fixed circuits', () => {
  it('solves a resistive divider', () => {
    const elements: Element[] = [
      { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
      { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
      { kind: 'resistor', a: 1, b: GROUND, ohms: 1000 },
    ];
    const solution = compare(elements, { nodeCount: 2 }, 'divider');
    expect(solution.voltages[0]).toBeCloseTo(5, 6);
    expect(solution.voltages[1]).toBeCloseTo(2.5, 6);
  });

  it('settles an unconnected net at ground through gmin', () => {
    compare(
      [{ kind: 'voltageSource', a: 0, b: GROUND, volts: 5 }],
      { nodeCount: 2 },
      'unconnected net',
    );
  });

  it('holds a dangling resistor at rail voltage', () => {
    compare(
      [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 10_000 },
      ],
      { nodeCount: 2 },
      'dangling resistor',
    );
  });

  it('biases a red LED on its measured forward voltage', () => {
    const solution = compare(ledCircuit(5, 330, DIODE_PROFILES.red), { nodeCount: 2 }, 'red LED');
    expect(solution.converged).toBe(true);
    expect(solution.voltages[1]).toBeGreaterThan(1.85);
    expect(solution.voltages[1]).toBeLessThan(2.05);
  });

  it('blocks a reverse-biased LED', () => {
    compare(ledCircuit(5, 1000, DIODE_PROFILES.red, true), { nodeCount: 2 }, 'reverse LED');
  });

  it('holds a signal diode near 0.7 V', () => {
    compare(ledCircuit(5, 1000, DIODE_PROFILES.silicon), { nodeCount: 2 }, 'silicon diode');
  });

  it('collapses an LED wired straight across the rail', () => {
    compare(ledCircuit(5, 0.1, DIODE_PROFILES.red), { nodeCount: 2 }, 'LED across rail');
  });

  it('draws large current through a dead short', () => {
    compare(
      [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 3.3 },
        { kind: 'resistor', a: 0, b: 1, ohms: 40 },
        { kind: 'resistor', a: 1, b: GROUND, ohms: 0.05 },
      ],
      { nodeCount: 2 },
      'dead short',
    );
  });

  it('charges a capacitor through one time constant', () => {
    const elements: Element[] = [
      { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
      { kind: 'resistor', a: 0, b: 1, ohms: 10_000 },
      { kind: 'capacitor', a: 1, b: GROUND, farads: 1e-6 },
    ];
    let previous: Float64Array | null = null;
    for (let step = 0; step < 1000; step++) {
      const oracle = solveCircuit(elements, {
        nodeCount: 2,
        dtSeconds: 1e-5,
        previousVoltages: previous,
      });
      const port = wasm.solve(elements, {
        nodeCount: 2,
        dtSeconds: 1e-5,
        previousVoltages: previous,
      });
      expectSameSolution(port, oracle, `capacitor step ${step}`);
      previous = oracle.voltages;
    }
    expect(previous?.[1]).toBeGreaterThan(3.0);
    expect(previous?.[1]).toBeLessThan(3.3);
  });

  it('handles a singular matrix the same way', () => {
    // Two ideal sources in parallel with different voltages: no solution.
    compare(
      [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 3 },
      ],
      { nodeCount: 1 },
      'parallel sources',
    );
  });

  it('handles an empty circuit', () => {
    compare([], { nodeCount: 0 }, 'empty');
    compare([], { nodeCount: 3 }, 'empty with nets');
  });

  it('ignores a ground element exactly like the oracle', () => {
    compare(
      [
        { kind: 'ground', node: 1 },
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
      ],
      { nodeCount: 2 },
      'ground element',
    );
  });
});

describe('C++ solver parity: randomized differential fuzzing', () => {
  it('matches the oracle on 1000 generated circuits', () => {
    const random = mulberry32(0x20_10_20_26);
    for (let caseIndex = 0; caseIndex < 1000; caseIndex++) {
      const { elements, options } = randomCircuit(random);
      compare(elements, options, `random case ${caseIndex}`);
    }
  });
});

describe('C++ solver bridge guards', () => {
  it('refuses repeated element objects', () => {
    const element: Element = { kind: 'resistor', a: 0, b: GROUND, ohms: 1000 };
    expect(() => wasm.solve([element, element], { nodeCount: 1 })).toThrow(/distinct/);
  });

  it('refuses a net outside the circuit', () => {
    expect(() =>
      wasm.solve([{ kind: 'resistor', a: 0, b: 2, ohms: 1000 }], { nodeCount: 2 }),
    ).toThrow(/outside/);
  });
});

/** Small deterministic PRNG so a failure reproduces from the case number. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCircuit(random: () => number): { elements: Element[]; options: SolveOptions } {
  const nodeCount = Math.floor(random() * 6); // 0..5
  const elementCount = Math.floor(random() * 13); // 0..12
  const net = (): number =>
    nodeCount === 0 || random() < 0.2 ? GROUND : Math.floor(random() * nodeCount);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];

  const elements: Element[] = [];
  for (let i = 0; i < elementCount; i++) {
    const roll = random();
    if (roll < 0.32) {
      elements.push({
        kind: 'resistor',
        a: net(),
        b: net(),
        ohms: 10 ** (random() * 7 - 1),
      });
    } else if (roll < 0.5) {
      elements.push({
        kind: 'voltageSource',
        a: net(),
        b: net(),
        volts: (random() * 2 - 1) * 12,
      });
    } else if (roll < 0.63) {
      elements.push({
        kind: 'currentSource',
        a: net(),
        b: net(),
        amps: (random() * 2 - 1) * 0.05,
      });
    } else if (roll < 0.78) {
      elements.push({
        kind: 'capacitor',
        a: net(),
        b: net(),
        farads: 10 ** (random() * 12 - 12),
      });
    } else if (roll < 0.96) {
      elements.push({
        kind: 'diode',
        a: net(),
        b: net(),
        profile: random() < 0.5 ? pick(Object.values(DIODE_PROFILES)) : randomProfile(random),
      });
    } else {
      elements.push({ kind: 'ground', node: Math.max(0, net()) });
    }
  }

  const options: SolveOptions = {
    nodeCount,
    dtSeconds: pick([1e-6, 1e-5, 1e-4, 1e-3, 1 / 60]),
    previousVoltages:
      random() < 0.5
        ? Float64Array.from({ length: nodeCount }, () => (random() * 2 - 1) * 5)
        : null,
    maxIterations: pick([1, 2, 5, 20, 100]),
    tolerance: pick([1e-9, 1e-7, 1e-5, 1e-3]),
  };

  return { elements, options };
}

function randomProfile(random: () => number): DiodeProfile {
  return {
    forwardVolts: 0.5 + random() * 3,
    ratedAmps: 0.001 + random() * 0.049,
    seriesOhms: 0.1 + random() * 20,
    ideality: 1 + random() * 1.5,
    leakageAmps: 10 ** (-10 + random() * 4),
    breakdownVolts: 3 + random() * 77,
    breakdownAmps: 0.01 + random() * 0.19,
  };
}
