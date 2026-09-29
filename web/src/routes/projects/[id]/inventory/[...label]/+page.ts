import type { PageLoad } from "./$types";

// The inspected entity is part of the URL, not just the page: the rest param
// is the definition's label ("battery"), mirroring the modeling route's view
// parameter. A rest param rather than a single segment so a label containing a
// slash still resolves, and because it matches the empty string, this one
// route serves both `/projects/<id>/inventory` (nothing requested — the page
// then opens the first entity and rewrites the URL) and
// `/projects/<id>/inventory/battery`.
export const load: PageLoad = ({ params }) => ({
  label: params.label,
});
