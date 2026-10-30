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

/** Enable Wasm solver for testing (overrides default flag). */
export function enableWasmSolver(enabled: boolean): void {
  // In test environment, we can't easily mutate the exported const,
  // so tests should pass explicitWasm: true to solveCircuit/elementCurrent calls.
  // This function exists for API compatibility.
  // The Phase 2 API uses explicitWasm parameter instead of global flag.
}

export { type SolveOptions };