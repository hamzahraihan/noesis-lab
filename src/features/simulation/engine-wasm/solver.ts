/**
 * WebAssembly bridge for the C++ MNA solver (issue #20, phase 1).
 *
 * The C++ core in `solver.cpp` is freestanding wasm32 and mirrors the
 * TypeScript solver in `../circuit.ts` and `../matrix.ts` operation for
 * operation. This module is the narrow FFI seam: it packs `Element[]` into the
 * 24-byte record the core reads, installs the diode profile table, and copies
 * the solved voltages and branch currents back out.
 *
 * The TypeScript solver stays the default until the final cutover. This loader
 * exists so the port can be exercised against the oracle on every circuit the
 * suite already covers, and so later phases have an ABI to extend rather than
 * a second solver to write.
 *
 * ABI (mirrored in solver.cpp; keep the offsets in sync):
 *   ElementIn: i32 kind, i32 a, i32 b, i32 profile, f64 value -- 24 bytes.
 *   ProfileIn: seven f64 in DiodeProfile order -- 56 bytes.
 * `set_profiles` copies the table into the core, so the upload buffer is
 * reusable. `solve` returns 1 converged, 0 not converged, -1 singular,
 * -2 out of memory.
 */

import type { Solution, SolveOptions } from '../circuit';
import { GROUND, type DiodeProfile, type Element } from '../elements';
import { instantiateEngine, type EngineExports } from './engine';

const ELEMENT_BYTES = 24;
const PROFILE_DOUBLES = 7;

const KIND: Record<Element['kind'], number> = {
  resistor: 0,
  voltageSource: 1,
  currentSource: 2,
  capacitor: 3,
  diode: 4,
  ground: 5,
};

export interface WasmSolver {
  /** Solve one timestep, with the same contract as `solveCircuit`. */
  solve(elements: readonly Element[], options: SolveOptions): Solution;
  /** Current through element `index`, positive from `a` to `b`. */
  elementCurrent(index: number, elements: readonly Element[], solution: Solution): number;
}

/** Loads the committed wasm artifact. `loadBytes` is the test seam. */
export async function loadWasmSolver(
  loadBytes?: () => Promise<ArrayBuffer>,
): Promise<WasmSolver> {
  const exports = await instantiateEngine(loadBytes);
  return new WasmSolverImpl(exports);
}

class WasmSolverImpl implements WasmSolver {
  private elementPtr = 0;
  private elementCapacity = 0;
  private profilePtr = 0;
  private profileCapacity = 0;
  private previousPtr = 0;
  private previousCapacity = 0;
  private voltsPtr = 0;
  private voltsCapacity = 0;
  private elementCount = 0;

  private readonly exports: EngineExports;

  constructor(exports: EngineExports) {
    this.exports = exports;
  }

  solve(elements: readonly Element[], options: SolveOptions): Solution {
    const nodeCount = options.nodeCount;
    if (!Number.isInteger(nodeCount) || nodeCount < 0) {
      throw new Error(`solver.wasm: nodeCount must be a non-negative integer, got ${nodeCount}`);
    }
    const dt = options.dtSeconds ?? 1e-4;
    const maxIterations = options.maxIterations ?? 100;
    const tolerance = options.tolerance ?? 1e-7;

    const sourceCount = this.upload(elements, nodeCount);
    const size = nodeCount + sourceCount;
    const previous = this.uploadPrevious(options.previousVoltages ?? null, size);

    const status = this.exports.solve(
      this.elementPtr,
      this.elementCount,
      nodeCount,
      dt,
      previous.ptr,
      previous.count,
      maxIterations,
      tolerance,
    );
    if (status < -1) throw new Error(`solver.wasm: solve failed (${status})`);

    const voltages = new Float64Array(nodeCount);
    if (nodeCount > 0) {
      voltages.set(
        new Float64Array(this.exports.memory.buffer, this.exports.result_voltages(), nodeCount),
      );
    }

    const sourceCurrents: number[] = new Array(sourceCount);
    if (sourceCount > 0) {
      const view = new Float64Array(
        this.exports.memory.buffer,
        this.exports.result_source_currents(),
        sourceCount,
      );
      for (let i = 0; i < sourceCount; i++) sourceCurrents[i] = view[i];
    }

    return {
      voltages,
      sourceCurrents,
      converged: status === 1,
      iterations: this.exports.result_iterations(),
    };
  }

  elementCurrent(index: number, elements: readonly Element[], solution: Solution): number {
    const nodeCount = solution.voltages.length;
    this.upload(elements, nodeCount);
    if (nodeCount > 0) {
      const allocation = this.allocate(this.voltsPtr, this.voltsCapacity, nodeCount * 8);
      this.voltsPtr = allocation.ptr;
      this.voltsCapacity = allocation.capacity;
      new Float64Array(this.exports.memory.buffer, this.voltsPtr, nodeCount).set(
        solution.voltages,
      );
    }
    return this.exports.element_current(
      index,
      this.elementPtr,
      this.elementCount,
      this.voltsPtr,
      nodeCount,
    );
  }

  /** Packs the element array and installs its diode profiles. */
  private upload(elements: readonly Element[], nodeCount: number): number {
    const allocation = this.allocate(
      this.elementPtr,
      this.elementCapacity,
      elements.length * ELEMENT_BYTES,
    );
    this.elementPtr = allocation.ptr;
    this.elementCapacity = allocation.capacity;

    const view = new DataView(this.exports.memory.buffer);
    const profiles: DiodeProfile[] = [];
    const profileIndex = new Map<DiodeProfile, number>();
    const seen = new Set<Element>();
    const validNet = (net: number): boolean =>
      net === GROUND || (Number.isInteger(net) && net >= 0 && net < nodeCount);
    let sourceCount = 0;

    elements.forEach((element, index) => {
      if (seen.has(element)) {
        throw new Error(
          `solver.wasm: element ${index} repeats an earlier object; the oracle keys branch rows and junction limits by identity, so elements must be distinct`,
        );
      }
      seen.add(element);

      const base = this.elementPtr + index * ELEMENT_BYTES;
      let a = -1;
      let b = -1;
      let profile = -1;
      let value = 0;

      switch (element.kind) {
        case 'resistor':
          a = element.a;
          b = element.b;
          value = element.ohms;
          break;
        case 'voltageSource':
          a = element.a;
          b = element.b;
          value = element.volts;
          sourceCount++;
          break;
        case 'currentSource':
          a = element.a;
          b = element.b;
          value = element.amps;
          break;
        case 'capacitor':
          a = element.a;
          b = element.b;
          value = element.farads;
          break;
        case 'diode': {
          a = element.a;
          b = element.b;
          let indexForProfile = profileIndex.get(element.profile);
          if (indexForProfile === undefined) {
            indexForProfile = profiles.length;
            profileIndex.set(element.profile, indexForProfile);
            profiles.push(element.profile);
          }
          profile = indexForProfile;
          break;
        }
        case 'ground':
          a = element.node;
          break;
      }

      if (element.kind !== 'ground' && (!validNet(a) || !validNet(b))) {
        throw new Error(
          `solver.wasm: element ${index} (${element.kind}) has net ${!validNet(a) ? a : b}, outside 0..${nodeCount - 1} and GROUND`,
        );
      }

      view.setInt32(base, KIND[element.kind], true);
      view.setInt32(base + 4, a, true);
      view.setInt32(base + 8, b, true);
      view.setInt32(base + 12, profile, true);
      view.setFloat64(base + 16, value, true);
    });

    this.uploadProfiles(profiles);
    this.elementCount = elements.length;
    return sourceCount;
  }

  private uploadProfiles(profiles: readonly DiodeProfile[]): void {
    const bytes = profiles.length * PROFILE_DOUBLES * 8;
    const allocation = this.allocate(this.profilePtr, this.profileCapacity, bytes);
    this.profilePtr = allocation.ptr;
    this.profileCapacity = allocation.capacity;

    if (profiles.length > 0) {
      const view = new Float64Array(
        this.exports.memory.buffer,
        this.profilePtr,
        profiles.length * PROFILE_DOUBLES,
      );
      profiles.forEach((profile, index) => {
        const offset = index * PROFILE_DOUBLES;
        view[offset] = profile.forwardVolts;
        view[offset + 1] = profile.ratedAmps;
        view[offset + 2] = profile.seriesOhms;
        view[offset + 3] = profile.ideality;
        view[offset + 4] = profile.leakageAmps;
        view[offset + 5] = profile.breakdownVolts;
        view[offset + 6] = profile.breakdownAmps;
      });
    }

    // The core compares the bytes and rebuilds curves only when the table
    // changed, so calling this on every solve is cheap.
    if (this.exports.set_profiles(this.profilePtr, profiles.length) === 0) {
      throw new Error('solver.wasm: out of memory installing diode profiles');
    }
  }

  private uploadPrevious(
    previous: Float64Array | null,
    size: number,
  ): { ptr: number; count: number } {
    if (previous === null || previous.length === 0 || size === 0) return { ptr: 0, count: 0 };
    const count = Math.min(previous.length, size);
    const allocation = this.allocate(this.previousPtr, this.previousCapacity, size * 8);
    this.previousPtr = allocation.ptr;
    this.previousCapacity = allocation.capacity;
    new Float64Array(this.exports.memory.buffer, this.previousPtr, size).set(
      previous.subarray(0, count),
    );
    return { ptr: this.previousPtr, count };
  }

  private allocate(
    ptr: number,
    capacity: number,
    bytes: number,
  ): { ptr: number; capacity: number } {
    if (bytes <= capacity) return { ptr, capacity };
    const next = this.exports.wasm_alloc(bytes);
    if (next === 0) throw new Error('solver.wasm: out of memory');
    return { ptr: next, capacity: bytes };
  }
}
