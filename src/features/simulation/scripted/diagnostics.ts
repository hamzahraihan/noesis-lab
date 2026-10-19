/**
 * The one place a script fault becomes something a person can see.
 *
 * The spec's rule is that failure is loud and latched: the part goes quiet from
 * the first fault on, which the solver and the bus both honour, and the fault
 * itself has to reach the operator rather than only the model. The Problems
 * panel is where these rows belong; until it grows one, the console is the one
 * place every backend has, and this is deliberately once per part per fault --
 * a script that throws on every call must not turn the solver into a log spout.
 */

const reported = new Map<string, string>();

/** Reports a part's fault the first time it is seen, and never the same one twice. */
export function reportFault(partId: string, fault: string): void {
  if (reported.get(partId) === fault) return;
  reported.set(partId, fault);
  console.warn(`scripted part ${partId}: ${fault}`);
}

/** Forgets a part's faults, because Reset is the operator's retry. */
export function clearReportedFaults(): void {
  reported.clear();
}
