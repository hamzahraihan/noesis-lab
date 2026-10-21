/**
 * The one place a script fault becomes something a person can see.
 *
 * The spec's rule is that failure is loud and latched: the part goes quiet from
 * the first fault on, which the solver and the bus both honour, and the fault
 * itself has to reach the operator rather than only the model. The Problems
 * panel owns a row for each of these -- one per part per fault, and never the
 * same one twice, so a script that throws on every call does not turn the
 * solver into a log spout. The console keeps a line of it too, because it is
 * the one place every backend has.
 */

export interface ScriptFault {
  readonly partId: string;
  readonly fault: string;
}

const reported = new Map<string, string>();

/** Reports a part's fault the first time it is seen, and never the same one twice. */
export function reportFault(partId: string, fault: string): void {
  if (reported.get(partId) === fault) return;
  reported.set(partId, fault);
  console.warn(`scripted part ${partId}: ${fault}`);
}

/**
 * The latched faults, for the Problems panel and for whatever transport sits
 * between it and the runtime (the worker reports its own realm's rows).
 */
export function reportedFaults(): readonly ScriptFault[] {
  return [...reported].map(([partId, fault]) => ({ partId, fault }));
}

/** Forgets one part's fault, because its script answered again. */
export function clearFault(partId: string): void {
  reported.delete(partId);
}

/** Forgets a part's faults, because Reset is the operator's retry. */
export function clearReportedFaults(): void {
  reported.clear();
}
