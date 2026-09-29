import type { PageLoad } from "./$types";

// The open view is part of the URL, not just the page: the rest param is the
// view file's path relative to `views/` ("main.hcl", "drone/airframe.hcl"),
// mirroring the embed route. A rest param rather than a single segment so a
// view in a sub-folder keeps its whole path, and because it matches the empty
// string, this one route serves both `/projects/<id>/modeling` (nothing
// requested — the page then opens the first view and rewrites the URL) and
// `/projects/<id>/modeling/main.hcl`. Being a single route is what lets a
// view switch reuse this component instead of tearing the canvas down.
export const load: PageLoad = ({ params }) => ({
  view: params.view,
});
