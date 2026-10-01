// A tiny cross-component signal for opening a palette.
//
// The navbar's palette button lives in the root layout while the palettes
// themselves mount in the project layout — no props cross that boundary, so
// the two rendezvous here, exactly as the guided tour's trigger and host do
// (see ./tour/tourRequest.svelte.ts).
//
// The host only exists inside a project, so this deliberately carries no
// project id: with no project open there is nothing to open, and the button
// that can raise a request is only rendered when there is one.
import type { PaletteKind } from "../components/commandPalette";

const request = $state({
  generation: 0,
  kind: null as PaletteKind | null,
  projectId: null as string | null,
});

export function getPaletteRequest(): {
  readonly generation: number;
  readonly kind: PaletteKind | null;
  readonly projectId: string | null;
} {
  return request;
}

/**
 * Asks a project's palettes to show. The target project is named for the
 * same reason the tour request names its own: a request left over from a
 * project you have since left must not ambush the next one you open.
 */
export function requestPalette(
  kind: PaletteKind,
  projectId: string,
): void {
  request.kind = kind;
  request.projectId = projectId;
  request.generation += 1;
}
