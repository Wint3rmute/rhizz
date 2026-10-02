// The palette's command rows: every workspace page. The rows come from the
// shared WORKSPACE_PAGES list the navbar renders, so a new page appears in
// the palette by being added to the navbar rather than by being remembered
// twice.
//
// Only the *pages* live here. The project's views are files, so they are
// rows like any other (see ./fileSwitcher) — a separate "Views" group would
// have listed the same diagrams twice under two different labels, once
// bare (`main.hcl`) and once folder-qualified (`views/main.hcl`).
//
// Rows are built here and *navigated* by the host — `commandItems` takes
// the callback, because building a URL is the one thing that needs `$app`
// and the open project id.
import type { PaletteItem } from "../components/palette/commandPalette";
import { WORKSPACE_PAGES } from "./workspacePages";

export const NAVIGATE_GROUP = "Navigate";

export function commandItems(
  onPage: (pageId: string) => void,
): PaletteItem[] {
  return WORKSPACE_PAGES.map<PaletteItem>((page) => ({
    id: `command:page:${page.id}`,
    label: `Go to ${page.label}`,
    icon: page.icon,
    group: NAVIGATE_GROUP,
    // The bare word is searchable even though it is not drawn, so
    // "inventory" finds the row that reads "Go to Inventory".
    hint: `${page.label} page open`,
    action: () => {
      onPage(page.id);
    },
  }));
}
