/**
<<<<<<< HEAD
 * Feature-flagged solver seam for issue #21 phase 1.
 *
 * `solveCircuit` routes to the C++ Wasm solver when the rollout flag is on
 * and to the TypeScript oracle in `./circuit` otherwise. The flag defaults
 * off so the shipped behaviour is unchanged until Stage 3 flips it
 * (mirroring `WASM_DEFAULT` in `avr/wasm-core.ts`).
 *
 * The Wasm artifact (`engine-wasm/solver.wasm`) is a committed build output
 * produced by `npm run build:engine`; tests load it directly through
 * `loadWasmSolver` from `./engine-wasm/solver`.
 */

import type { Solution, SolveOptions } from './circuit';
import { solveCircuit as solveCircuitTs, elementCurrent as elementCurrentTs } from './circuit';
import type { Element } from './elements';
import { loadWasmSolver, type WasmSolver } from './engine-wasm/solver';

/** Rollout default (Stage 3 flips this to true once the gates pass). */
export const WASM_SOLVER_DEFAULT = false;

/** Resolves whether the Wasm solver is active for this session. */
export function resolveWasmSolver(explicit?: boolean): boolean {
  return explicit ?? WASM_SOLVER_DEFAULT;
}

let wasmSolver: WasmSolver | null = null;

/** Lazily loads the committed Wasm artifact and caches the bridge. */
async function loadWasm(): Promise<WasmSolver> {
  if (wasmSolver === null) {
    wasmSolver = await loadWasmSolver();
  }
  return wasmSolver;
}

/**
 * Solve one timestep. Routes to the C++ Wasm solver when the flag is on,
 * otherwise to the TypeScript oracle in `./circuit`. Same contract as
 * `solveCircuit` in `./circuit`.
 */
export async function solveCircuit(
  elements: readonly Element[],
  options: SolveOptions,
  explicitWasm?: boolean,
): Promise<Solution> {
  if (resolveWasmSolver(explicitWasm)) {
    const wasm = await loadWasm();
    return wasm.solve(elements, options);
  }
  return solveCircuitTs(elements, options);
}

/** Current through element `index`, positive from `a` to `b`, in Wasm realm. */
export async function elementCurrent(
  index: number,
  elements: readonly Element[],
  solution: Solution,
  explicitWasm?: boolean,
): Promise<number> {
  if (resolveWasmSolver(explicitWasm)) {
    const wasm = await loadWasm();
    return wasm.elementCurrent(index, elements, solution);
  }
  return elementCurrentTs(elements[index], solution);
}

/** Eagerly preloads the Wasm artifact so the first solve isn't blocked on fetch. */
export async function preloadWasmSolver(): Promise<void> {
  if (resolveWasmSolver()) await loadWasm();
}

export { type SolveOptions };
=======
 * TypeScript wrapper for the C++ circuit solver (Wasm).
 *
 * Feature-flagged via `import.meta.env.VITE_WASM_SOLVER` or `localStorage`.
 * When disabled, falls back to the TypeScript solver in `circuit.ts`.
 */

import { GROUND, type DiodeProfile, type Element } from './elements';
import { GMIN } from './units';
import type { SolveOptions, Solution } from './circuit';

// ============================================================================
// Type Definitions (matching C API)
// ============================================================================

const enum WasmElementKind {
  Resistor = 0,
  VoltageSource = 1,
  CurrentSource = 2,
  Capacitor = 3,
  Diode = 4,
  Ground = 5,
}

interface WasmDiodeProfile {
  forwardVolts: number;
  ratedAmps: number;
  seriesOhms: number;
  ideality: number;
  leakageAmps: number;
  breakdownVolts: number;
  breakdownAmps: number;
}

interface WasmElement {
  kind: WasmElementKind;
  a: number;
  b: number;
  ohms: number;
  volts: number;
  amps: number;
  farads: number;
  profile: WasmDiodeProfile;
}

interface WasmOptions {
  nodeCount: number;
  dtSeconds: number;
  previousVoltages: Float64Array | null;
  maxIterations: number;
  tolerance: number;
}

interface WasmSolution {
  voltages: Float64Array;
  sourceCurrents: number[];
  converged: boolean;
  iterations: number;
}

// ============================================================================
// Wasm Module Loader
// ============================================================================

interface SolverModule {
  _solver_solve(
    elementsPtr: number,
    elementCount: number,
    optionsPtr: number,
    outSolutionPtr: number,
  ): number;
  _solver_free_solution(solutionPtr: number): void;
  _solver_element_current(elementPtr: number, solutionPtr: number): number;
  _solver_linearise_diode(
    voltageAcross: number,
    profilePtr: number,
    outAmpsPtr: number,
    outSiemensPtr: number,
  ): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  HEAP8: Int8Array;
}

let wasmModule: SolverModule | null = null;
let wasmLoadPromise: Promise<SolverModule> | null = null;

// Feature flag: enable Wasm solver via env var or localStorage
function isWasmEnabled(): boolean {
  if (typeof import.meta.env.VITE_WASM_SOLVER === 'string') {
    return import.meta.env.VITE_WASM_SOLVER === 'true';
  }
  if (typeof window !== 'undefined') {
    return localStorage.getItem('wasm-solver-enabled') === 'true';
  }
  return false;
}

async function loadWasmModule(): Promise<SolverModule> {
  if (wasmModule) return wasmModule;
  if (wasmLoadPromise) return wasmLoadPromise;

  wasmLoadPromise = (async () => {
    // Dynamic import of the generated glue code
    const moduleFactory = await import('../../../dist/assets/solver.js?url');
    const wasmUrl = new URL(moduleFactory.default, import.meta.url).href;

    const SolverModule = (await import(/* @vite-ignore */ wasmUrl)).default;
    const instance = await SolverModule({
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) return wasmUrl.replace('solver.js', 'solver.wasm');
        return path;
      },
    });

    wasmModule = instance as unknown as SolverModule;
    return wasmModule;
  })();

  return wasmLoadPromise;
}

// ============================================================================
// Marshalling Helpers
// ============================================================================

function diodeProfileToWasm(profile: DiodeProfile): WasmDiodeProfile {
  return {
    forwardVolts: profile.forwardVolts,
    ratedAmps: profile.ratedAmps,
    seriesOhms: profile.seriesOhms,
    ideality: profile.ideality,
    leakageAmps: profile.leakageAmps,
    breakdownVolts: profile.breakdownVolts,
    breakdownAmps: profile.breakdownAmps,
  };
}

function elementToWasm(element: Element): WasmElement {
  const base: WasmElement = {
    kind: WasmElementKind.Ground, // default
    a: element.a,
    b: element.b,
    ohms: 0,
    volts: 0,
    amps: 0,
    farads: 0,
    profile: {
      forwardVolts: 0,
      ratedAmps: 0,
      seriesOhms: 0,
      ideality: 0,
      leakageAmps: 0,
      breakdownVolts: 0,
      breakdownAmps: 0,
    },
  };

  switch (element.kind) {
    case 'resistor':
      base.kind = WasmElementKind.Resistor;
      base.ohms = element.ohms;
      break;
    case 'voltageSource':
      base.kind = WasmElementKind.VoltageSource;
      base.volts = element.volts;
      break;
    case 'currentSource':
      base.kind = WasmElementKind.CurrentSource;
      base.amps = element.amps;
      break;
    case 'capacitor':
      base.kind = WasmElementKind.Capacitor;
      base.farads = element.farads;
      break;
    case 'diode':
      base.kind = WasmElementKind.Diode;
      base.profile = diodeProfileToWasm(element.profile);
      break;
    case 'ground':
      base.kind = WasmElementKind.Ground;
      break;
  }

  return base;
}

function writeWasmElement(heap: Float64Array | Int32Array, offset: number, element: WasmElement): void {
  // WasmElement layout (matching C struct with 32-bit Wasm):
  // kind (i32): 4 bytes at offset 0
  // a (i32): 4 bytes at offset 4
  // b (i32): 4 bytes at offset 8
  // padding: 4 bytes at offset 12 (align doubles to 8 bytes)
  // ohms (f64): 8 bytes at offset 16
  // volts (f64): 8 bytes at offset 24
  // amps (f64): 8 bytes at offset 32
  // farads (f64): 8 bytes at offset 40
  // profile.forwardVolts (f64): 8 bytes at offset 48
  // profile.ratedAmps (f64): 8 bytes at offset 56
  // profile.seriesOhms (f64): 8 bytes at offset 64
  // profile.ideality (f64): 8 bytes at offset 72
  // profile.leakageAmps (f64): 8 bytes at offset 80
  // profile.breakdownVolts (f64): 8 bytes at offset 88
  // profile.breakdownAmps (f64): 8 bytes at offset 96
  // Total: 104 bytes

  const i32 = new Int32Array(heap.buffer);
  const f64 = new Float64Array(heap.buffer);

  // Integers
  const i32Offset = offset / 4;
  i32[i32Offset + 0] = element.kind;
  i32[i32Offset + 1] = element.a;
  i32[i32Offset + 2] = element.b;
  // i32[i32Offset + 3] = padding (already zero from malloc)

  // Doubles - start at offset 16 (8-byte aligned)
  const f64Offset = (offset + 16) / 8;
  f64[f64Offset + 0] = element.ohms;
  f64[f64Offset + 1] = element.volts;
  f64[f64Offset + 2] = element.amps;
  f64[f64Offset + 3] = element.farads;
  f64[f64Offset + 4] = element.profile.forwardVolts;
  f64[f64Offset + 5] = element.profile.ratedAmps;
  f64[f64Offset + 6] = element.profile.seriesOhms;
  f64[f64Offset + 7] = element.profile.ideality;
  f64[f64Offset + 8] = element.profile.leakageAmps;
  f64[f64Offset + 9] = element.profile.breakdownVolts;
  f64[f64Offset + 10] = element.profile.breakdownAmps;
}

function writeWasmOptions(heap: Float64Array | Int32Array, offset: number, options: WasmOptions, prevVoltagesPtr: number): void {
  const i32 = new Int32Array(heap.buffer);
  const f64 = new Float64Array(heap.buffer);

  // WasmOptions layout (matching C struct with 32-bit Wasm):
  // nodeCount (i32): 4 bytes at offset 0
  // padding: 4 bytes at offset 4 (align double)
  // dtSeconds (f64): 8 bytes at offset 8
  // previousVoltages (ptr): 4 bytes at offset 16
  // maxIterations (i32): 4 bytes at offset 20
  // tolerance (f64): 8 bytes at offset 24
  // Total: 32 bytes

  const i32Offset = offset / 4;
  i32[i32Offset + 0] = options.nodeCount;
  // i32[i32Offset + 1] = padding (zero)
  f64[(offset + 8) / 8] = options.dtSeconds;
  i32[i32Offset + 4] = prevVoltagesPtr; // pointer at offset 16
  i32[i32Offset + 5] = options.maxIterations;
  f64[(offset + 24) / 8] = options.tolerance;
}

// ============================================================================
// Main Solver Function
// ============================================================================

/**
 * Solve circuit using Wasm solver.
 * Falls back to TS solver if Wasm is disabled or fails to load.
 */
export async function solveCircuitWasm(
  elements: readonly Element[],
  options: SolveOptions,
): Promise<Solution> {
  if (!isWasmEnabled()) {
    // Import TS solver dynamically to avoid circular dependency
    const { solveCircuit } = await import('./circuit');
    return solveCircuit(elements, options);
  }

  try {
    const mod = await loadWasmModule();

    // Convert elements
    const wasmElements = elements.map(elementToWasm);
    const elementSize = 104; // bytes per WasmElement (matching C struct layout)

    // Allocate memory for elements array
    const elementsPtr = mod._malloc(wasmElements.length * elementSize);
    if (elementsPtr === 0) throw new Error('Wasm malloc failed for elements');

    try {
      // Write elements
      for (let i = 0; i < wasmElements.length; ++i) {
        writeWasmElement(mod.HEAPF64, elementsPtr + i * elementSize, wasmElements[i]);
      }

      // Prepare previous voltages
      let prevVoltagesPtr = 0;
      if (options.previousVoltages) {
        prevVoltagesPtr = mod._malloc(options.previousVoltages.byteLength);
        if (prevVoltagesPtr === 0) throw new Error('Wasm malloc failed for previousVoltages');
        const prevHeap = new Float64Array(mod.HEAPF64.buffer, prevVoltagesPtr, options.previousVoltages.length);
        prevHeap.set(options.previousVoltages);
      }

      // Write options
      const optionsPtr = mod._malloc(32); // 32 bytes for WasmOptions
      if (optionsPtr === 0) throw new Error('Wasm malloc failed for options');

      const wasmOptions: WasmOptions = {
        nodeCount: options.nodeCount,
        dtSeconds: options.dtSeconds ?? 1e-4,
        previousVoltages: options.previousVoltages ?? null,
        maxIterations: options.maxIterations ?? 100,
        tolerance: options.tolerance ?? 1e-7,
      };
      writeWasmOptions(mod.HEAPF64, optionsPtr, wasmOptions, prevVoltagesPtr);

      // Allocate output solution struct (we'll read back the pointers)
      // WasmSolution layout in C (32-bit Wasm):
      // voltages (double*): 4 bytes at offset 0
      // sourceCurrents (double*): 4 bytes at offset 4
      // sourceCount (i32): 4 bytes at offset 8
      // converged (i32): 4 bytes at offset 12
      // iterations (i32): 4 bytes at offset 16
      // Total: 20 bytes
      const solutionPtr = mod._malloc(20);
      if (solutionPtr === 0) throw new Error('Wasm malloc failed for solution');

      // Call solver
      const errorCode = mod._solver_solve(elementsPtr, wasmElements.length, optionsPtr, solutionPtr);

      // Read solution struct
      const i32 = new Int32Array(mod.HEAPF64.buffer);

      const solPtr = solutionPtr / 4;
      const voltagesPtr = i32[solPtr + 0];
      const sourceCurrentsPtr = i32[solPtr + 1];
      const sourceCount = i32[solPtr + 2];
      const converged = i32[solPtr + 3] !== 0;
      const iterations = i32[solPtr + 4];

      // Copy voltages
      const voltages = new Float64Array(options.nodeCount);
      if (voltagesPtr !== 0) {
        const voltagesHeap = new Float64Array(mod.HEAPF64.buffer, voltagesPtr, options.nodeCount);
        voltages.set(voltagesHeap);
      }

      // Copy source currents
      const sourceCurrents: number[] = [];
      if (sourceCurrentsPtr !== 0 && sourceCount > 0) {
        const currentsHeap = new Float64Array(mod.HEAPF64.buffer, sourceCurrentsPtr, sourceCount);
        for (let i = 0; i < sourceCount; ++i) {
          sourceCurrents.push(currentsHeap[i]);
        }
      }

      // Free Wasm-allocated memory
      if (voltagesPtr !== 0) mod._free(voltagesPtr);
      if (sourceCurrentsPtr !== 0) mod._free(sourceCurrentsPtr);
      mod._free(solutionPtr);
      if (prevVoltagesPtr !== 0) mod._free(prevVoltagesPtr);

      if (errorCode !== 0) {
        // Singular matrix or other error - return non-converged
        return {
          voltages,
          sourceCurrents,
          converged: false,
          iterations,
        };
      }

      return {
        voltages,
        sourceCurrents,
        converged,
        iterations,
      };
    } finally {
      mod._free(elementsPtr);
    }
  } catch (error) {
    console.warn('[Wasm Solver] Failed, falling back to TS solver:', error);
    const { solveCircuit } = await import('./circuit');
    return solveCircuit(elements, options);
  }
}

/**
 * Compute element current using Wasm solver.
 */
export async function elementCurrentWasm(element: Element, solution: Solution): Promise<number> {
  if (!isWasmEnabled()) {
    const { elementCurrent } = await import('./circuit');
    return elementCurrent(element, solution);
  }

  try {
    const mod = await loadWasmModule();
    const wasmElement = elementToWasm(element);
    const elementSize = 104;

    const elementPtr = mod._malloc(elementSize);
    if (elementPtr === 0) throw new Error('Wasm malloc failed');
    try {
      writeWasmElement(mod.HEAPF64, elementPtr, wasmElement);

      // Prepare solution struct for element_current
      // WasmSolution layout: voltages ptr, sourceCurrents ptr, sourceCount, converged, iterations
      const solSize = 20;
      const solPtr = mod._malloc(solSize);
      if (solPtr === 0) throw new Error('Wasm malloc failed for solution');

      const voltagesPtr = mod._malloc(solution.voltages.byteLength);
      if (voltagesPtr === 0) throw new Error('Wasm malloc failed for voltages');

      try {
        const voltagesHeap = new Float64Array(mod.HEAPF64.buffer, voltagesPtr, solution.voltages.length);
        voltagesHeap.set(solution.voltages);

        // Write solution struct
        const i32 = new Int32Array(mod.HEAPF64.buffer);
        const solI32 = solPtr / 4;
        i32[solI32 + 0] = voltagesPtr;
        i32[solI32 + 1] = 0; // sourceCurrents ptr
        i32[solI32 + 2] = 0; // sourceCount
        i32[solI32 + 3] = 1; // converged
        i32[solI32 + 4] = 0; // iterations

        const current = mod._solver_element_current(elementPtr, solPtr);
        return current;
      } finally {
        mod._free(voltagesPtr);
        mod._free(solPtr);
      }
    } finally {
      mod._free(elementPtr);
    }
  } catch (error) {
    console.warn('[Wasm Solver] elementCurrent failed, falling back:', error);
    const { elementCurrent } = await import('./circuit');
    return elementCurrent(element, solution);
  }
}

// ============================================================================
// Feature Flag Control
// ============================================================================

export function enableWasmSolver(enabled: boolean): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('wasm-solver-enabled', enabled ? 'true' : 'false');
  }
  // Clear cached module so it reloads with new setting
  wasmModule = null;
  wasmLoadPromise = null;
}

export function isWasmSolverEnabled(): boolean {
  return isWasmEnabled();
}
>>>>>>> origin/main
