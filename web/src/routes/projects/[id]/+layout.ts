import type { LayoutLoad } from "./$types";

export const ssr = false;
export const prerender = false;

// Just threads the route param through as page/layout data — the actual
// project lookup (and "does this id even exist" check) happens
// client-side in +layout.svelte, via the shared ProjectState store.
export const load: LayoutLoad = ({ params }) => {
  return { projectId: params.id };
};
