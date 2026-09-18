// A module-level fan-out for the model mutations Rust reports.
//
// The UI edits the model through short-lived call sites (each handler loads
// the primary HCL, mutates, writes back), so mutations are recorded through
// one process-wide observer list rather than per-instance state. That lets the
// diagrams page aggregate a whole session's mutations into its action log
// without threading a logger through every handler.
//
// Opt-in: the list is empty by default, so the simulation harness and unit
// tests — which mutate models to verify invariants — never emit anything
// unless a caller subscribes.
import type { ModelAction } from "./actionLog";

type MutationObserver = (action: ModelAction) => void;

const mutationObservers = new Set<MutationObserver>();

/** Subscribes to every reported model mutation. Returns an unsubscribe function. */
export function subscribeToMutations(
  observer: MutationObserver,
): () => void {
  mutationObservers.add(observer);
  return () => {
    mutationObservers.delete(observer);
  };
}

/** Forwards one Rust-reported model action to the observers. */
export function recordModelAction(action: ModelAction): void {
  for (const observer of mutationObservers) observer(action);
}
