// A tiny cross-component signal for opening settings.
//
// The settings button lives in Navbar (root layout) while the command
// palette mounts in the project layout — no props cross that boundary, so
// the two rendezvous here, exactly as the palette's own trigger and the
// guided tour's trigger/host do (see ./paletteRequest.svelte.ts and
// ../tour/tourRequest.svelte.ts).
//
// Settings is global, so this deliberately names no project: a bare
// generation bump is the whole request.
const request = $state({
  generation: 0,
});

export function getSettingsRequest(): {
  readonly generation: number;
} {
  return request;
}

/** Asks the navbar to open the settings modal. */
export function requestSettings(): void {
  request.generation += 1;
}
