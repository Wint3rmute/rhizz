// A tiny cross-component signal for opening the palette.
//
// The navbar's palette button lives in the root layout while the palette
// itself mounts in the project layout — no props cross that boundary, so
// the two rendezvous here, exactly as the guided tour's trigger and host do
// (see ./tour/tourRequest.svelte.ts).
//
// The host only exists inside a project, so this deliberately carries no
// "which list" or "which palette" — there is one, and it lists everything.
// It does name its target project, for the same reason the tour's request
// does: a request left over from a project you have since left must not
// ambush the next one you open.
const request = $state({
  generation: 0,
  projectId: null as string | null,
});

export function getPaletteRequest(): {
  readonly generation: number;
  readonly projectId: string | null;
} {
  return request;
}

/** Asks a project's palette to open. */
export function requestPalette(projectId: string): void {
  request.projectId = projectId;
  request.generation += 1;
}
