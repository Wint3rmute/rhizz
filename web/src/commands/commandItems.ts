// What Ctrl-Shift-P offers: every workspace page, plus every view in the
// project. The page rows come from the shared WORKSPACE_PAGES list the
// navbar renders, so a new page appears in the palette by being added to
// the navbar rather than by being remembered twice.
//
// Rows are built here and *navigated* by the host — `paletteCommands` takes
// the callbacks, because building a URL is the one thing that needs
// `$app` and the open project id.
import type { PaletteItem } from "../components/palette/commandPalette";
import { VIEW_LAYOUT_DIR } from "../routes/projects/[id]/modeling/persistence";
import { WORKSPACE_PAGES } from "./workspacePages";

export const NAVIGATE_GROUP = "Navigate";
export const VIEWS_GROUP = "Views";

export interface CommandCallbacks {
  /** Navigate to a workspace page by id. */
  onPage: (pageId: string) => void;
  /** Open a view by its path relative to `views/`. */
  onView: (view: string) => void;
}

export function paletteCommands(
  views: readonly string[],
  callbacks: CommandCallbacks,
): PaletteItem[] {
  return [
    ...WORKSPACE_PAGES.map<PaletteItem>((page) => ({
      id: `command:page:${page.id}`,
      label: `Go to ${page.label}`,
      icon: page.icon,
      group: NAVIGATE_GROUP,
      // The bare word is searchable even though it is not drawn, so
      // "inventory" finds the row that reads "Go to Inventory".
      hint: `${page.label} page open`,
      action: () => {
        callbacks.onPage(page.id);
      },
    })),
    // Sorted, so the untyped list is the same order on every open — the
    // views come off the filesystem, which has no opinion about it.
    ...[...views]
      .sort((a, b) => a.localeCompare(b))
      .map<PaletteItem>((view) => ({
        id: `command:view:${view}`,
        label: view,
        detail: VIEW_LAYOUT_DIR,
        group: VIEWS_GROUP,
        hint: `${VIEW_LAYOUT_DIR} view open diagram`,
        action: () => {
          callbacks.onView(view);
        },
      })),
  ];
}
