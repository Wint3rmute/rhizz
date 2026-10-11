// A tiny cross-component signal for starting the project tour.
//
// The tour button lives in Navbar (root layout) while the tour itself
// mounts in the project layout — no props cross that boundary, so the two
// rendezvous here. The request optionally names its target project:
// a tour host only answers requests aimed at its own project (or
// project-less ones), so stale requests never ambush other projects.
import { safeGetItem, safeRemoveItem, safeSetItem } from "../safeStorage";
const request = $state({
  generation: 0,
  projectId: null as string | null,
});

export function getTourRequest(): {
  readonly generation: number;
  readonly projectId: string | null;
} {
  return request;
}

/** Requests the project tour to (re)start, optionally aimed at one project. */
export function requestTourStart(projectId: string | null = null): void {
  request.projectId = projectId;
  request.generation += 1;
}

const PENDING_TOUR_KEY = "rhizz-pending-tour";

/**
 * Arms a one-shot tour start for the next project page mount — set when
 * the user's first project is created, so creation opens the tutorial.
 * Degrades to a no-op without storage: the tour simply will not auto-start.
 */
export function pendTourStart(): void {
  safeSetItem(PENDING_TOUR_KEY, "1");
}

/** Consumes the armed start (once); false when nothing was armed. */
export function consumePendingTourStart(): boolean {
  const pending = safeGetItem(PENDING_TOUR_KEY);
  if (pending === null) return false;
  safeRemoveItem(PENDING_TOUR_KEY);
  return true;
}
