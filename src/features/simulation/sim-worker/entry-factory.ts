/**
 * Sim worker factory: the single place a `Worker` is constructed for the
 * simulation offload.
 *
 * The URL stays a same-feature relative `./worker.ts` so the boundary gate
 * (which forbids cross-feature relative imports into `features/`) keeps
 * passing: bench reaches the worker only through this barrel export, never
 * by constructing a relative URL of its own.
 */
export function createSimWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}
