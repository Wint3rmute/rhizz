// The palette's file rows: the project files a page offers, and where each
// one goes when chosen.
//
// A row's destination follows from *what the file is*, not from which page
// you summoned the palette on. A `.hcl` under `views/` is a diagram, so it
// opens on the canvas in Modeling; everything else opens in the editor. One
// rule, no dependence on where you are standing — so every project file is
// reachable from the pages that are about files, which is what makes a
// single palette worth having over a per-page file list. The page decides
// only *whether* to offer them (see ./paletteScope), never where one lands.
//
// The items are built here but nothing here knows how to *navigate*: a row
// carries its path and `fileTargetFor` reads it, so the host can turn a
// chosen label into a URL without this module ever touching `$app`.
import type { PaletteItem } from "../components/palette/commandPalette";
import { VIEW_LAYOUT_DIR } from "../routes/projects/[id]/modeling/persistence";
import type { Dirent } from "../vfs/fs";
import type { PaletteScope } from "./paletteScope";

/**
 * Where a chosen file takes the user. A view is addressed by its path
 * relative to `views/`, which is exactly what the modeling route's rest
 * param takes (`/modeling/drone/engine.hcl`); anything else is addressed by
 * its project-relative path, which the code page reads off `?file=`.
 */
export type FileTarget =
  | { kind: "view"; view: string }
  | { kind: "file"; path: string };

/** Whether this path is a view file, i.e. a `.hcl` directly under `views/`. */
function isViewPath(path: string): boolean {
  return path.startsWith(`${VIEW_LAYOUT_DIR}/`) && path.endsWith(".hcl");
}

export function fileTargetFor(path: string): FileTarget {
  return isViewPath(path)
    ? { kind: "view", view: path.slice(VIEW_LAYOUT_DIR.length + 1) }
    : { kind: "file", path };
}

/**
 * Turns a recursive listing into palette rows, labelled by the project path
 * — which is also exactly what `fileTargetFor` reads, so a host can
 * navigate from a chosen row by handing that label straight back.
 *
 * Narrowed to the diagrams in the `views` scope, which is what the pages
 * that draw diagrams ask for, and to nothing at all in the `none` scope,
 * which is what Inventory asks for: the listing it hands over is never
 * turned into a row. The label stays the full project path wherever rows
 * exist on purpose: a shorter `main.hcl` on the diagrams would mean a
 * second path convention and a `fileTargetFor` that had to know which scope
 * produced the row — the confusion that a per-scope listing already caused
 * once.
 *
 * Directories never appear: you switch to a file, not to a folder.
 */
export function fileItems(
  entries: readonly Dirent[],
  scope: PaletteScope,
): PaletteItem[] {
  if (scope.files === "none") return [];
  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) => scope.files === "all" || isViewPath(entry.path))
    .map<PaletteItem>((entry) => ({
      id: `file:${entry.path}`,
      label: entry.path,
      // Searchable but not drawn — "view" finds the diagrams without the
      // word appearing on any row.
      hint: isViewPath(entry.path) ? `${VIEW_LAYOUT_DIR} view diagram` : "file",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
