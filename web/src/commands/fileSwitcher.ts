// The file switcher: what Ctrl-P offers, given where you are standing.
//
// Which set of files is *valid* depends on the page — Modeling and Explore
// both draw diagrams, so there the useful answer is "a view", while on Code
// it is "a file in the project". The search is always project-scoped; the
// switcher never leaves the open project.
//
// The items are built here but nothing here knows how to *navigate*: a row
// carries a `SwitcherTarget` and the host turns that into a URL. That
// split is what keeps this module testable without `$app`, and it keeps the
// two questions — "what is offered?" and "where does it go?" — from
// tangling.
import type { PaletteItem } from "../components/commandPalette";
import { VIEW_LAYOUT_DIR } from "../routes/projects/[id]/modeling/persistence";
import type { Dirent, ProjectFs } from "../vfs/fs";

/** Which set of files the switcher offers on the current page. */
export type SwitcherScope = "views" | "files";

/**
 * Where a chosen row should take the user. A view is addressed by its path
 * relative to `views/`, which is exactly what the modeling route's rest
 * param takes (`/modeling/drone/engine.hcl`); a file is addressed by its
 * project-relative path, which the code page reads off `?file=`.
 */
export type SwitcherTarget =
  | { kind: "view"; view: string }
  | { kind: "file"; path: string };

/**
 * Pages that draw diagrams ask for views, and everything else asks for the
 * whole project. Read off the pathname's third segment
 * (`/projects/<id>/<subpage>/…`), the same idiom the e2e helpers use.
 */
export function switcherScopeForPath(pathname: string): SwitcherScope {
  const subpage = pathname.split("/")[3] ?? "";
  return subpage === "modeling" || subpage === "explore" ? "views" : "files";
}

export function switcherTargetFor(
  path: string,
  scope: SwitcherScope,
): SwitcherTarget {
  return scope === "views"
    ? { kind: "view", view: path }
    : { kind: "file", path };
}

/**
 * Turns a recursive listing into palette rows. A view's label drops the
 * `views/` prefix and keeps its nested path — the prefix is on every row
 * alike, so it carries no information, while "drone/engine.hcl" does.
 * Directories never appear: you switch to a file, not to a folder.
 */
export function fileSwitcherItems(
  entries: readonly Dirent[],
  scope: SwitcherScope,
): PaletteItem[] {
  const prefix = `${VIEW_LAYOUT_DIR}/`;
  const items: PaletteItem[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (scope === "views") {
      if (!entry.path.startsWith(prefix) || !entry.name.endsWith(".hcl")) {
        continue;
      }
      const view = entry.path.slice(prefix.length);
      items.push({
        id: `view:${view}`,
        label: view,
        detail: VIEW_LAYOUT_DIR,
        hint: `${VIEW_LAYOUT_DIR} view`,
      });
      continue;
    }
    items.push({
      id: `file:${entry.path}`,
      label: entry.path,
      hint: "file",
    });
  }

  // Sorted rather than left in readdir order: the untyped list is the one a
  // user reads top to bottom, and directory order is an implementation
  // detail of the store rather than anything meaningful.
  items.sort((a, b) => a.label.localeCompare(b.label));
  return items;
}

/**
 * Reads the whole project, recursively, as the listing every scope filters.
 * Deliberately one call for both scopes: `readdir` reports each entry's
 * path relative to the directory it was called with, so reading `views/`
 * directly would hand back `main.hcl` where the files scope hands back
 * `views/main.hcl` — two path conventions for the same rows, and a
 * `fileSwitcherItems` that has to know which one it got. A project is a
 * handful of files; walking it once is not worth that.
 */
export async function readProjectEntries(fs: ProjectFs): Promise<Dirent[]> {
  return fs.readdir(".", { recursive: true });
}
