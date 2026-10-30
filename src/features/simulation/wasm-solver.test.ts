/**
 * Parity tests for Wasm solver vs TypeScript solver.
 *
 * These tests verify that the C++ Wasm solver produces identical results
 * to the TypeScript solver within the specified tolerance (1e-7 V).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeAll } from 'vitest';
import { GROUND, type DiodeProfile, type Element } from './elements';
import { DIODE_PROFILES } from '@/features/parts';
import { solveCircuit, elementCurrent, type Solution, type SolveOptions } from './circuit';
import { loadWasmSolver, type WasmSolver } from './engine-wasm/solver';

const TOLERANCE = 1e-7;

let wasm: WasmSolver;

// Helper to compare two solutions
function expectSolutionsClose(wasm: Solution, ts: Solution, label: string) {
  expect(wasm.converged).toBe(ts.converged);
  expect(wasm.iterations).toBe(ts.iterations);
  expect(wasm.sourceCurrents.length).toBe(ts.sourceCurrents.length);

  for (let i = 0; i < ts.voltages.length; ++i) {
    expect(wasm.voltages[i]).toBeCloseTo(ts.voltages[i], 7, `${label} voltage[${i}]`);
  }
  for (let i = 0; i < ts.sourceCurrents.length; ++i) {
    expect(wasm.sourceCurrents[i]).toBeCloseTo(ts.sourceCurrents[i], 7, `${label} sourceCurrent[${i}]`);
  }
}

function expectCurrentsClose(wasm: number, ts: number, label: string) {
  expect(wasm).toBeCloseTo(ts, 7, label);
}

// Test circuit builders (matching circuit.test.ts)
function ledCircuit(
  supply: number,
  seriesOhms: number,
  profile: DiodeProfile,
  reversed = false,
): { elements: Element[]; solution: Solution } {
  const elements: Element[] = [
    { kind: 'voltageSource', a: 0, b: GROUND, volts: supply },
    { kind: 'resistor', a: 0, b: 1, ohms: seriesOhms },
    {
      kind: 'diode',
      a: reversed ? GROUND : 1,
      b: reversed ? 1 : GROUND,
      profile,
    },
  ];
  return { elements, solution: solveCircuit(elements, { nodeCount: 2 }) };
}

function runToSettle(
  elements: Element[],
  nodeCount: number,
  dtSeconds: number,
  steps: number,
  initial?: Float64Array,
): Solution {
  let solution = solveCircuit(elements, { nodeCount, dtSeconds, previousVoltages: initial });
  for (let step = 0; step < steps; step++) {
    solution = solveCircuit(elements, {
      nodeCount,
      dtSeconds,
      previousVoltages: solution.voltages,
    });
  }
  return solution;
}

async function runToSettleWasm(
  elements: Element[],
  nodeCount: number,
  dtSeconds: number,
  steps: number,
  initial?: Float64Array,
): Promise<Solution> {
  let solution = await wasm.solve(elements, { nodeCount, dtSeconds, previousVoltages: initial });
  for (let step = 0; step < steps; step++) {
    solution = await wasm.solve(elements, {
      nodeCount,
      dtSeconds,
      previousVoltages: solution.voltages,
    });
  }
  return solution;
}

describe('Wasm Solver Parity', () => {
  beforeAll(async () => {
    const buffer = readFileSync('src/features/simulation/engine-wasm/solver.wasm');
    const bytes = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    wasm = await loadWasmSolver(async () => bytes);
  });

  describe('MNA solver parity', () => {
    it('divides voltage across a resistive divider', async () => {
      const elements: Element[] = [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
        { kind: 'resistor', a: 1, b: GROUND, ohms: 1000 },
      ];

      const ts = solveCircuit(elements, { nodeCount: 2 });
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      expectSolutionsClose(wasmSol, ts, 'resistive divider');
    });

    it('reports the current drawn by the divider through the source branch', async () => {
      const elements: Element[] = [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
        { kind: 'resistor', a: 1, b: GROUND, ohms: 1000 },
      ];

      const ts = solveCircuit(elements, { nodeCount: 2 });
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      expectSolutionsClose(wasmSol, ts, 'divider source current');
    });

    it('settles a genuinely unconnected net at ground', async () => {
      const elements: Element[] = [{ kind: 'voltageSource', a: 0, b: GROUND, volts: 5 }];

      const ts = solveCircuit(elements, { nodeCount: 2 });
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      expectSolutionsClose(wasmSol, ts, 'unconnected net');
    });

    it('holds a resistor dangling from the rail at rail voltage', async () => {
      const elements: Element[] = [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 10_000 },
      ];

      const ts = solveCircuit(elements, { nodeCount: 2 });
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      expectSolutionsClose(wasmSol, ts, 'dangling resistor');
    });

    it('biases a voltage divider formed by pull-up and pull-down', async () => {
      const elements: Element[] = [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 3.3 },
        { kind: 'resistor', a: 1, b: 0, ohms: 10_000 },
        { kind: 'resistor', a: 1, b: GROUND, ohms: 10_000 },
      ];

      const ts = solveCircuit(elements, { nodeCount: 2 });
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      expectSolutionsClose(wasmSol, ts, 'pull-up pull-down divider');
    });
  });

  describe('nonlinear junctions parity', () => {
    it('settles a red LED on its measured forward voltage', async () => {
      const { elements, solution: ts } = ledCircuit(5, 330, DIODE_PROFILES.red);
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      expectSolutionsClose(wasmSol, ts, 'red LED');
    });

    it('makes a blue LED dimmer than a red one from the same supply', async () => {
      const red = ledCircuit(5, 330, DIODE_PROFILES.red);
      const blue = ledCircuit(5, 330, DIODE_PROFILES.blue);

      const redWasm = await wasm.solve(red.elements, { nodeCount: 2 });
      const blueWasm = await wasm.solve(blue.elements, { nodeCount: 2 });

      expectSolutionsClose(redWasm, red.solution, 'red LED wasm');
      expectSolutionsClose(blueWasm, blue.solution, 'blue LED wasm');

      expect(blueWasm.voltages[1]).toBeGreaterThan(redWasm.voltages[1] + 0.7);
      const redCurrent = elementCurrent(red.elements[2], red.solution);
      const blueCurrent = elementCurrent(blue.elements[2], blue.solution);
      expect(blueCurrent).toBeLessThan(redCurrent);
    });

    it('dims an LED when the supply drops', async () => {
      const atFive = ledCircuit(5, 330, DIODE_PROFILES.red);
      const atThreeThree = ledCircuit(3.3, 330, DIODE_PROFILES.red);

      const atFiveWasm = await wasm.solve(atFive.elements, { nodeCount: 2 });
      const atThreeThreeWasm = await wasm.solve(atThreeThree.elements, { nodeCount: 2 });

      expectSolutionsClose(atFiveWasm, atFive.solution, '5V LED');
      expectSolutionsClose(atThreeThreeWasm, atThreeThree.solution, '3.3V LED');

      const fiveCurrent = elementCurrent(atFive.elements[2], atFive.solution);
      const threeCurrent = elementCurrent(atThreeThree.elements[2], atThreeThree.solution);
      expect(threeCurrent).toBeLessThan(fiveCurrent);
    });

    it('leaves a reverse-biased LED essentially non-conducting', async () => {
      const { elements, solution: ts } = ledCircuit(5, 1000, DIODE_PROFILES.red, true);
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      expectSolutionsClose(wasmSol, ts, 'reverse LED');
    });

    it('holds a signal diode near its 0.7 V forward drop', async () => {
      const { elements, solution: ts } = ledCircuit(5, 1000, DIODE_PROFILES.silicon);
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      expectSolutionsClose(wasmSol, ts, 'silicon diode');
    });
  });

  describe('transients parity', () => {
    it('charges a capacitor through roughly one time constant', async () => {
      const elements: Element[] = [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 10_000 },
        { kind: 'capacitor', a: 1, b: GROUND, farads: 1e-6 },
      ];

      const ts = runToSettle(elements, 2, 1e-5, 1000);
      const wasmSol = await runToSettleWasm(elements, 2, 1e-5, 1000);

      expectSolutionsClose(wasmSol, ts, 'capacitor charge');
    });

    it('keeps charging toward the supply and holds once there', async () => {
      const elements: Element[] = [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 3.3 },
        { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
        { kind: 'capacitor', a: 1, b: GROUND, farads: 10e-6 },
      ];

      const earlyTs = runToSettle(elements, 2, 1e-4, 20);
      const lateTs = runToSettle(elements, 2, 1e-4, 1200);

      const earlyWasm = await runToSettleWasm(elements, 2, 1e-4, 20);
      const lateWasm = await runToSettleWasm(elements, 2, 1e-4, 1200);

      expectSolutionsClose(earlyWasm, earlyTs, 'early charge');
      expectSolutionsClose(lateWasm, lateTs, 'late charge');
    });

    it('discharges a capacitor once the supply is removed', async () => {
      const charging: Element[] = [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
        { kind: 'capacitor', a: 1, b: GROUND, farads: 10e-6 },
      ];
      const chargedTs = runToSettle(charging, 2, 1e-4, 1200);
      const chargedWasm = await runToSettleWasm(charging, 2, 1e-4, 1200);

      expectSolutionsClose(chargedWasm, chargedTs, 'charged cap');

      const bleeding: Element[] = [
        { kind: 'resistor', a: 1, b: GROUND, ohms: 1000 },
        { kind: 'capacitor', a: 1, b: GROUND, farads: 10e-6 },
      ];
      const bledTs = runToSettle(bleeding, 2, 1e-4, 1200, chargedTs.voltages);
      const bledWasm = await runToSettleWasm(bleeding, 2, 1e-4, 1200, chargedWasm.voltages);

      expectSolutionsClose(bledWasm, bledTs, 'discharged cap');
    });
  });

  describe('fault behaviour parity', () => {
    it('draws large current through a dead short across the rail', async () => {
      const elements: Element[] = [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 3.3 },
        { kind: 'resistor', a: 0, b: 1, ohms: 40 },
        { kind: 'resistor', a: 1, b: GROUND, ohms: 0.05 },
      ];

      const ts = solveCircuit(elements, { nodeCount: 2 });
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      expectSolutionsClose(wasmSol, ts, 'dead short');
    });

    it('collapses an LED wired straight across the rail', async () => {
      const { elements, solution: ts } = ledCircuit(5, 0.1, DIODE_PROFILES.red);
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      expectSolutionsClose(wasmSol, ts, 'LED short');
    });
  });

  describe('elementCurrent parity', () => {
    it('computes resistor current correctly', async () => {
      const elements: Element[] = [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
        { kind: 'resistor', a: 1, b: GROUND, ohms: 1000 },
      ];

      const ts = solveCircuit(elements, { nodeCount: 2 });
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      const tsCurrent = elementCurrent(elements[1], ts);
      const wasmCurrent = wasm.elementCurrent(1, elements, wasmSol);

      expectCurrentsClose(wasmCurrent, tsCurrent, 'resistor current');
    });

    it('computes diode current correctly', async () => {
      const { elements, solution: ts } = ledCircuit(5, 330, DIODE_PROFILES.red);
      const wasmSol = await wasm.solve(elements, { nodeCount: 2 });

      const tsCurrent = elementCurrent(elements[2], ts);
      const wasmCurrent = wasm.elementCurrent(2, elements, wasmSol);

      expectCurrentsClose(wasmCurrent, tsCurrent, 'diode current');
    });
  });

  describe('random circuit fuzzing', () => {
    it('matches TS solver on random circuits', async () => {
      const rng = new PRNG(12345);

      for (let trial = 0; trial < 50; ++trial) {
        const nodeCount = rng.int(2, 6);
        const elements: Element[] = [];

        // Always add a voltage source at node 0
        elements.push({ kind: 'voltageSource', a: 0, b: GROUND, volts: rng.float(1, 5) });

        // Add random elements
        const elementCount = rng.int(2, 8);
        for (let i = 0; i < elementCount; ++i) {
          const kind = rng.int(0, 3); // 0=resistor, 1=current, 2=capacitor, 3=diode
          const a = rng.int(0, nodeCount - 1);
          const b = rng.int(-1, nodeCount - 1); // -1 = GROUND

          switch (kind) {
            case 0:
              elements.push({ kind: 'resistor', a, b, ohms: rng.float(100, 100_000) });
              break;
            case 1:
              elements.push({ kind: 'currentSource', a, b, amps: rng.float(-0.1, 0.1) });
              break;
            case 2:
              elements.push({ kind: 'capacitor', a, b, farads: rng.float(1e-9, 1e-4) });
              break;
            case 3:
              const profile = rng.choose([DIODE_PROFILES.red, DIODE_PROFILES.blue, DIODE_PROFILES.silicon]);
              elements.push({ kind: 'diode', a, b, profile });
              break;
          }
        }

        const ts = solveCircuit(elements, { nodeCount, dtSeconds: 1e-4 });
        const wasmSol = await wasm.solve(elements, { nodeCount, dtSeconds: 1e-4 });

        expectSolutionsClose(wasmSol, ts, `random circuit ${trial}`);
      }
    });
  });
});

// Simple PRNG for reproducible fuzzing
class PRNG {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    this.state = Math.imul(1664525, this.state) + 1013904223;
    return this.state >>> 0;
  }
  float(min: number, max: number): number {
    return min + (this.next() / 0xffffffff) * (max - min);
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.float(0, max - min + 1));
  }
  choose<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
}