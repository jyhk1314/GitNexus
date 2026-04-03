/**
 * Intentionally linear CALLS chain (4 hops) for pipeline / process-detection fixtures.
 * Each function calls only the next — no parallel callees from one symbol for this chain.
 */
export function chainD(): string {
  return 'done';
}

export function chainC(): string {
  return chainD();
}

export function chainB(): string {
  return chainC();
}

export function chainA(): string {
  return chainB();
}
