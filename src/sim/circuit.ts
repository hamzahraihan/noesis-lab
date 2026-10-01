/**
 * Modified Nodal Analysis solver with Newton-Raphson for nonlinear junctions.
 *
 * Every solve re-stamps the whole matrix from the current element list and the
 * working node-voltage guess, then re-factorises. Bench circuits are small, so
 * that brute-force iteration costs far less than tracking per-element state
 * would, and it keeps the assembly auditable: if a device is not stamped below,
 * it is simply not modelled.
 *
 * Conventions:
 *   - A net index of `GROUND` (-1) is the 0 V reference and has no matrix row.
 *   - Positive current into a node is injected from outside that node.
 *   - Voltage-source branch current is positive flowing into the source's `a`.
 */

import { GROUND, lineariseDiode, type Element } from './elements';
import { LUDecomposition, SingularMatrixError } from './matrix';
import { GMIN } from './units';

export interface SolveOptions {
  /** Number of real, probe-able nets. Net i is index i of `Solution.voltages`. */
  nodeCount: number;
  /** Timestep in seconds. Only consulted when the netlist has capacitors. */
  dtSeconds?: number;
  /** Node voltages from the previous timestep, for capacitor companion models. */
  previousVoltages?: Float64Array | null;
  maxIterations?: number;
  /** Convergence threshold in volts. */
  tolerance?: number;
}
export interface Solution {
  /** Net voltages in volts, indexed by net. */
  voltages: Float64Array;
  /** Branch current in amps for each voltage source, in netlist order. */
  sourceCurrents: number[];
  converged: boolean;
  iterations: number;
}

/**
 * How far a junction's linearisation point may move per Newton iteration.
 *
 * A junction knee is far sharper than the rest of the circuit's resolution, so
 * an unconstrained step can throw the bias across it and land on the wrong side
 * of the characteristic. Walking the bias in bounded steps costs a few extra
 * iterations and makes convergence reliable instead of luck.
 */
const JUNCTION_LIMIT_STEP_VOLTS = 0.25;

export function solveCircuit(
  elements: readonly Element[],
  options: SolveOptions,
): Solution {
  const { nodeCount } = options;
  const maxIterations = options.maxIterations ?? 100;
  const tolerance = options.tolerance ?? 1e-7;
  const dt = options.dtSeconds ?? 1e-4;

  const branchRowOf = new Map<Element, number>();
  let sourceCount = 0;
  for (const element of elements) {
    if (element.kind === 'voltageSource') {
      branchRowOf.set(element, nodeCount + sourceCount);
      sourceCount++;
    }
  }
  const size = nodeCount + sourceCount;

  const matrix = new Float64Array(size * size);
  const rhs = new Float64Array(size);
  const working = new Float64Array(size);
  const solved = new Float64Array(size);

  // Capacitor history is the previous *timestep*, which must stay fixed while
  // Newton iterates within the current one.
  const previousStep = options.previousVoltages ?? new Float64Array(nodeCount);
  if (options.previousVoltages) working.set(options.previousVoltages);

  const junctionBias = (element: Extract<Element, { kind: 'diode' }>): number =>
    (element.a >= 0 ? working[element.a] : 0) - (element.b >= 0 ? working[element.b] : 0);

  // Per-junction clamp, carried across Newton iterations and re-seeded from the
  // converged answer at the end of every timestep.
  const junctionLimit = new Map<Element, number>();

  let converged = false;
  let iterations = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    matrix.fill(0);
    rhs.fill(0);
    iterations = iteration;

    // While a junction is still clamped its linearisation deliberately
    // misrepresents the device, so node voltages can look settled mid-walk.
    // Convergence has to wait until every clamp releases.
    let limitingActive = false;

    // gmin keeps a net with nothing attached to it from making the matrix
    // singular. At 1 TOhm it sits far below any signal we care about.
    for (let net = 0; net < nodeCount; net++) {
      stampConductance(matrix, size, net, GROUND, GMIN);
    }

    for (const element of elements) {
      switch (element.kind) {
        case 'resistor': {
          stampConductance(matrix, size, element.a, element.b, 1 / element.ohms);
          break;
        }

        case 'currentSource': {
          stampCurrentSource(rhs, element.a, element.b, element.amps);
          break;
        }

        case 'voltageSource': {
          const row = branchRowOf.get(element);
          if (row !== undefined) {
            stampVoltageSource(matrix, rhs, size, element.a, element.b, row, element.volts);
          }
          break;
        }

        case 'capacitor': {
          // Backward Euler companion: I = (C/dt) * (V - Vprev). A conductance
          // plus a history current, unconditionally stable -- which is what
          // lets one fixed timestep carry several kHz of simulated PWM.
          const siemens = element.farads / dt;
          const prior =
            (element.a >= 0 ? previousStep[element.a] : 0) -
            (element.b >= 0 ? previousStep[element.b] : 0);
          stampConductance(matrix, size, element.a, element.b, siemens);
          stampCurrentSource(rhs, element.a, element.b, siemens * prior);
          break;
        }

        case 'diode': {
          const bias = junctionBias(element);
          const priorLimit = junctionLimit.get(element);
          const operatingVoltage =
            priorLimit === undefined
              ? bias
              : Math.min(Math.max(bias, priorLimit - JUNCTION_LIMIT_STEP_VOLTS),
                         priorLimit + JUNCTION_LIMIT_STEP_VOLTS);
          if (operatingVoltage !== bias) limitingActive = true;
          junctionLimit.set(element, operatingVoltage);

          const { amps, siemens } = lineariseDiode(operatingVoltage, element.profile);
          // Device current is siemens * v + (amps - siemens * operatingVoltage).
          // A `stampCurrentSource` argument is *injected into* the net while the
          // constant belongs on the leaving-current side, hence the negation.
          stampConductance(matrix, size, element.a, element.b, siemens);
          stampCurrentSource(rhs, element.a, element.b, siemens * operatingVoltage - amps);
          break;
        }
      }
    }

    let result: Float64Array;
    try {
      result = new LUDecomposition(matrix, size).solve(rhs, solved);
    } catch (error) {
      if (error instanceof SingularMatrixError) return snapshot(false);
      throw error;
    }

    let delta = 0;
    for (let i = 0; i < nodeCount; i++) {
      delta = Math.max(delta, Math.abs(result[i] - working[i]));
    }
    working.set(result);

    if (delta < tolerance && !limitingActive) {
      converged = true;
      break;
    }
  }

  // Re-seed the clamp from where the junctions actually finished, so the next
  // timestep starts at the real operating point rather than the last
  // artificially clamped one.
  for (const element of elements) {
    if (element.kind === 'diode' && junctionLimit.has(element)) {
      junctionLimit.set(element, junctionBias(element));
    }
  }

  return snapshot(converged);

  function snapshot(didConverge: boolean): Solution {
    const sourceCurrents: number[] = [];
    for (const element of elements) {
      if (element.kind !== 'voltageSource') continue;
      const row = branchRowOf.get(element);
      sourceCurrents.push(row === undefined ? 0 : working[row]);
    }

    return {
      voltages: Float64Array.from(working.subarray(0, nodeCount)),
      sourceCurrents,
      converged: didConverge,
      iterations,
    };
  }
}

/** Stamps a conductance between two nets; ground contributes no row. */
function stampConductance(
  matrix: Float64Array,
  size: number,
  a: number,
  b: number,
  siemens: number,
): void {
  if (a >= 0) matrix[a * size + a] += siemens;
  if (b >= 0) matrix[b * size + b] += siemens;
  if (a >= 0 && b >= 0) {
    matrix[a * size + b] -= siemens;
    matrix[b * size + a] -= siemens;
  }
}

/** Injects `amps` into net `a` and draws the same current out of net `b`. */
function stampCurrentSource(rhs: Float64Array, a: number, b: number, amps: number): void {
  if (a >= 0) rhs[a] += amps;
  if (b >= 0) rhs[b] -= amps;
}

/**
 * Stamps a fixed voltage source. The branch current is the unknown at `row`,
 * positive flowing into `a`, so net `a`'s KCL carries +1 in that column and net
 * `b`'s carries -1; the branch row itself enforces V(a) - V(b) = volts.
 */
function stampVoltageSource(
  matrix: Float64Array,
  rhs: Float64Array,
  size: number,
  a: number,
  b: number,
  row: number,
  volts: number,
): void {
  if (a >= 0) matrix[a * size + row] += 1;
  if (b >= 0) matrix[b * size + row] -= 1;
  if (a >= 0) matrix[row * size + a] += 1;
  if (b >= 0) matrix[row * size + b] -= 1;
  rhs[row] += volts;
}

/**
 * Current through a two-terminal element in amps, positive from `a` to `b`.
 *
 * Inductor current is not recoverable from the instantaneous companion model, so
 * it reports zero; the workbench does not place inductors yet.
 */
export function elementCurrent(element: Element, solution: Solution): number {
  if (element.kind === 'ground') return 0;

  const voltageA = element.a >= 0 ? solution.voltages[element.a] : 0;
  const voltageB = element.b >= 0 ? solution.voltages[element.b] : 0;

  switch (element.kind) {
    case 'resistor':
      return (voltageA - voltageB) / element.ohms;

    case 'currentSource':
      return element.amps;

    case 'voltageSource':
      return 0;

    case 'capacitor':
      return 0;

    case 'diode':
      return lineariseDiode(voltageA - voltageB, element.profile).amps;
  }
}