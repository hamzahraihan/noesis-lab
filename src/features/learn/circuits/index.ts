/**
 * Every circuit the curriculum and the gallery ship, as documents.
 *
 * The registry is generated from the JSON files in `circuits/` (see
 * `src/features/learn/generated/circuits-registry.ts`); this module re-exports
 * it under the long-standing public API (`CIRCUITS`, `CircuitId`).
 */

import { CIRCUITS } from '../generated/circuits-registry';

export { CIRCUITS };
export type { CircuitDocument } from '@/features/simulation';
export type CircuitId = keyof typeof CIRCUITS;
