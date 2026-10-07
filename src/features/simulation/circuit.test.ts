import { describe, expect, it } from 'vitest';
import { elementCurrent, solveCircuit, type Solution } from './circuit';
import { GROUND, type DiodeProfile, type Element } from './elements';
import { DIODE_PROFILES } from '@/features/parts';

/** Series resistor + LED from a supply, the most common bench circuit there is. */
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

/** Runs a netlist forward in time, optionally starting from a stored state. */
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

describe('MNA solver', () => {
  it('divides voltage across a resistive divider', () => {
    const solution = solveCircuit(
      [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
        { kind: 'resistor', a: 1, b: GROUND, ohms: 1000 },
      ],
      { nodeCount: 2 },
    );

    expect(solution.converged).toBe(true);
    expect(solution.voltages[0]).toBeCloseTo(5, 6);
    expect(solution.voltages[1]).toBeCloseTo(2.5, 6);
  });

  it('reports the current drawn by the divider through the source branch', () => {
    const solution = solveCircuit(
      [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
        { kind: 'resistor', a: 1, b: GROUND, ohms: 1000 },
      ],
      { nodeCount: 2 },
    );

    // 5 V across 2 kOhm. Negative because current flows out of the source's
    // + terminal into the divider.
    expect(solution.sourceCurrents[0]).toBeCloseTo(-0.0025, 9);
  });

  it('settles a genuinely unconnected net at ground', () => {
    // Net 1 has nothing attached to it at all -- the "I forgot to wire this
    // pin" case. It must read 0 V rather than making the matrix singular.
    const solution = solveCircuit(
      [{ kind: 'voltageSource', a: 0, b: GROUND, volts: 5 }],
      { nodeCount: 2 },
    );

    expect(solution.converged).toBe(true);
    expect(solution.voltages[0]).toBeCloseTo(5, 6);
    expect(solution.voltages[1]).toBeCloseTo(0, 9);
  });

  it('holds a resistor dangling from the rail at rail voltage', () => {
    // No current can leave, so there is no drop across the resistor. This is
    // why a floating input needs a pull-down to actually read as 0.
    const solution = solveCircuit(
      [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 10_000 },
      ],
      { nodeCount: 2 },
    );

    expect(solution.converged).toBe(true);
    expect(solution.voltages[1]).toBeCloseTo(5, 6);
  });

  it('biases a voltage divider formed by pull-up and pull-down', () => {
    const solution = solveCircuit(
      [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 3.3 },
        { kind: 'resistor', a: 1, b: 0, ohms: 10_000 },
        { kind: 'resistor', a: 1, b: GROUND, ohms: 10_000 },
      ],
      { nodeCount: 2 },
    );

    expect(solution.voltages[1]).toBeCloseTo(1.65, 6);
  });
});

describe('nonlinear junctions', () => {
  it('settles a red LED on its measured forward voltage', () => {
    const { elements, solution } = ledCircuit(5, 330, DIODE_PROFILES.red);

    expect(solution.converged).toBe(true);
    // Bench-measured reference: a red LED on 5 V through 330 Ohm sits near
    // 1.95 V carrying a little over 9 mA.
    expect(solution.voltages[1]).toBeGreaterThan(1.85);
    expect(solution.voltages[1]).toBeLessThan(2.05);
    expect(elementCurrent(elements[2], solution) * 1000).toBeGreaterThan(8.5);
    expect(elementCurrent(elements[2], solution) * 1000).toBeLessThan(10);
  });

  it('makes a blue LED dimmer than a red one from the same supply', () => {
    // The lesson behind the whole catalogue: forward voltage sets how much of
    // the supply survives as current. A blue LED's higher Vf eats the budget.
    const red = ledCircuit(5, 330, DIODE_PROFILES.red);
    const blue = ledCircuit(5, 330, DIODE_PROFILES.blue);

    expect(blue.solution.voltages[1]).toBeGreaterThan(red.solution.voltages[1] + 0.7);
    expect(elementCurrent(blue.elements[2], blue.solution)).toBeLessThan(
      elementCurrent(red.elements[2], red.solution),
    );
  });

  it('dims an LED when the supply drops', () => {
    const atFive = ledCircuit(5, 330, DIODE_PROFILES.red);
    const atThreeThree = ledCircuit(3.3, 330, DIODE_PROFILES.red);

    expect(elementCurrent(atThreeThree.elements[2], atThreeThree.solution)).toBeLessThan(
      elementCurrent(atFive.elements[2], atFive.solution),
    );
  });

  it('leaves a reverse-biased LED essentially non-conducting', () => {
    const { solution } = ledCircuit(5, 1000, DIODE_PROFILES.red, true);

    expect(solution.converged).toBe(true);
    // 100 nA of reverse leakage across 1 kOhm drops 0.1 mV: blocking, but
    // not the ideal diode the word "reverse" might suggest.
    expect(solution.voltages[1]).toBeCloseTo(5, 3);
  });

  it('holds a signal diode near its 0.7 V forward drop', () => {
    const { elements, solution } = ledCircuit(5, 1000, DIODE_PROFILES.silicon);

    expect(solution.converged).toBe(true);
    expect(solution.voltages[1]).toBeGreaterThan(0.6);
    expect(solution.voltages[1]).toBeLessThan(0.75);
    // Whatever the drop, the resistor and the diode must agree exactly.
    expect(elementCurrent(elements[2], solution)).toBeCloseTo(
      elementCurrent(elements[1], solution),
      6,
    );
  });
});

describe('transients', () => {
  it('charges a capacitor through roughly one time constant', () => {
    // R = 10 kOhm, C = 1 uF gives tau = 10 ms; a 10 us step is 1000 steps/tau.
    const solution = runToSettle(
      [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
        { kind: 'resistor', a: 0, b: 1, ohms: 10_000 },
        { kind: 'capacitor', a: 1, b: GROUND, farads: 1e-6 },
      ],
      2,
      1e-5,
      1000,
    );

    // Backward Euler lands a little under the exact 63.2% because it
    // under-shoots the true exponential; 3.0-3.3 V is the expected band.
    expect(solution.voltages[1]).toBeGreaterThan(3.0);
    expect(solution.voltages[1]).toBeLessThan(3.3);
  });

  it('keeps charging toward the supply and holds once there', () => {
    const elements: Element[] = [
      { kind: 'voltageSource', a: 0, b: GROUND, volts: 3.3 },
      { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
      { kind: 'capacitor', a: 1, b: GROUND, farads: 10e-6 },
    ];

    const early = runToSettle(elements, 2, 1e-4, 20);
    // tau = 1 kOhm * 10 uF = 10 ms; 1200 x 100 us is 12 time constants.
    const late = runToSettle(elements, 2, 1e-4, 1200);

    expect(late.voltages[1]).toBeGreaterThan(early.voltages[1]);
    expect(late.voltages[1]).toBeCloseTo(3.3, 2);
  });

  it('discharges a capacitor once the supply is removed', () => {
    const charging: Element[] = [
      { kind: 'voltageSource', a: 0, b: GROUND, volts: 5 },
      { kind: 'resistor', a: 0, b: 1, ohms: 1000 },
      { kind: 'capacitor', a: 1, b: GROUND, farads: 10e-6 },
    ];
    const charged = runToSettle(charging, 2, 1e-4, 1200);
    expect(charged.voltages[1]).toBeCloseTo(5, 3);

    // Swap the supply for a plain resistor to ground: the stored charge now has
    // somewhere to go.
    const bleeding: Element[] = [
      { kind: 'resistor', a: 1, b: GROUND, ohms: 1000 },
      { kind: 'capacitor', a: 1, b: GROUND, farads: 10e-6 },
    ];
    const bled = runToSettle(bleeding, 2, 1e-4, 1200, charged.voltages);

    expect(bled.voltages[1]).toBeLessThan(0.1);
  });
});

describe('fault behaviour', () => {
  it('draws large current through a dead short across the rail', () => {
    // 3.3 V rail shorted to ground through a pin's ~40 Ohm output impedance.
    const solution = solveCircuit(
      [
        { kind: 'voltageSource', a: 0, b: GROUND, volts: 3.3 },
        { kind: 'resistor', a: 0, b: 1, ohms: 40 },
        { kind: 'resistor', a: 1, b: GROUND, ohms: 0.05 },
      ],
      { nodeCount: 2 },
    );

    expect(solution.converged).toBe(true);
    // 3.3 V across ~40 Ohm: about 82 mA, far past what a pin should source.
    expect(Math.abs(solution.sourceCurrents[0])).toBeGreaterThan(0.05);
    expect(solution.voltages[1]).toBeLessThan(0.1);
  });

  it('collapses an LED wired straight across the rail', () => {
    // No series resistor: the junction and its own bulk resistance become the
    // only thing limiting current, so the rail voltage lands on the diode.
    const { elements, solution } = ledCircuit(5, 0.1, DIODE_PROFILES.red);

    expect(solution.converged).toBe(true);
    expect(solution.voltages[1]).toBeGreaterThan(3.5);
    expect(elementCurrent(elements[2], solution)).toBeGreaterThan(0.1);
  });
});