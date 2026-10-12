import { WORKSPACE_PAGES } from "./workspacePages";

// The third segment of a project URL: /projects/<id>/<page>(/...).
const PAGE_SEGMENT = /^\/projects\/[^/]+\/([^/]+)/;

// The browser tab mirrors the workspace: "Rhizz: <project> - <page>".
// The page is whatever follows /projects/<id>/ in the URL, resolved against
// the same WORKSPACE_PAGES list the navbar renders, so a new page is titled
// by being added to the navbar rather than by being remembered twice.
// Unknown segments (embeds, bad URLs) and off-project paths yield null and
// fall back to the project-only / bare forms in `formatPageTitle`.
export function pageLabelForPath(pathname: string): string | null {
  const segment = PAGE_SEGMENT.exec(pathname)?.[1];
  if (!segment) return null;
  return WORKSPACE_PAGES.find((page) => page.id === segment)?.label ?? null;
}

export function formatPageTitle(
  projectName: string | null,
  pageLabel: string | null,
): string {
  if (projectName && pageLabel) return `Rhizz: ${projectName} - ${pageLabel}`;
  if (projectName) return `Rhizz: ${projectName}`;
  return "Rhizz";
}
