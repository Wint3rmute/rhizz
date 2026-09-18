// A tiny cross-component signal for starting the project tour.
//
// The "Drone tour" button lives in Navbar (root layout) while the tour
// itself mounts in the project layout — no props cross that boundary, so
// the two rendezvous here: the button bumps the signal, the tour watches
// it (same pattern as the walkthrough demo's local startSignal).
let startSignal = $state(0);

/** The current start-generation; read inside a `$derived` to stay live. */
export function getTourStartSignal(): number {
  return startSignal;
}

/** Requests the project tour to (re)start from its first step. */
export function requestTourStart(): void {
  startSignal += 1;
}
