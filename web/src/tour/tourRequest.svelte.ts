// A tiny cross-component signal for starting the project tour.
//
// The tour button lives in Navbar (root layout) while the tour itself
// mounts in the project layout — no props cross that boundary, so the two
// rendezvous here. The request optionally names its target project:
// a tour host only answers requests aimed at its own project (or
// project-less ones), so stale requests never ambush other projects.
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
