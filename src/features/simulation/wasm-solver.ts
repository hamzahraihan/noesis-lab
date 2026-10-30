/**
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

const WASM_SOLVER_STORAGE_KEY = 'wasm-solver-enabled';

function readStoredWasmSolverFlag(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(WASM_SOLVER_STORAGE_KEY) === 'true';
}

let wasmSolverEnabled = readStoredWasmSolverFlag();

/** Resolves whether the Wasm solver is active for this session. */
export function resolveWasmSolver(explicit?: boolean): boolean {
  return explicit ?? wasmSolverEnabled;
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

/**
 * Backward-compatible API used by existing Phase 1 tests.
 */
export async function solveCircuitWasm(
  elements: readonly Element[],
  options: SolveOptions,
): Promise<Solution> {
  return solveCircuitTs(elements, options);
}

/**
 * Backward-compatible API used by existing Phase 1 tests.
 */
export async function elementCurrentWasm(element: Element, solution: Solution): Promise<number> {
  return elementCurrentTs(element, solution);
}

export function enableWasmSolver(enabled: boolean): void {
  wasmSolverEnabled = enabled;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(WASM_SOLVER_STORAGE_KEY, enabled ? 'true' : 'false');
  }
}

export function isWasmSolverEnabled(): boolean {
  return wasmSolverEnabled;
}

export { type SolveOptions };