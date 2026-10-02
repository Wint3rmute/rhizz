// The palette's file rows: every file in the open project, and where each
// one goes when chosen.
//
// A row's destination follows from *what the file is*, not from which page
// you summoned the palette on. A `.hcl` under `views/` is a diagram, so it
// opens on the canvas in Modeling; everything else opens in the editor. One
// rule, no dependence on where you are standing — and every project file
// is reachable from anywhere, which is the thing that makes a single
// palette worth having over a per-page file list.
//
// The items are built here but nothing here knows how to *navigate*: a row
// carries its path and `fileTargetFor` reads it, so the host can turn a
// chosen label into a URL without this module ever touching `$app`.
import type { PaletteItem } from "../components/palette/commandPalette";
import { VIEW_LAYOUT_DIR } from "../routes/projects/[id]/modeling/persistence";
import type { Dirent, ProjectFs } from "../vfs/fs";

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
 * Directories never appear: you switch to a file, not to a folder.
 */
export function fileItems(entries: readonly Dirent[]): PaletteItem[] {
  return entries
    .filter((entry) => entry.isFile())
    .map<PaletteItem>((entry) => ({
      id: `file:${entry.path}`,
      label: entry.path,
      // Searchable but not drawn — "view" finds the diagrams without the
      // word appearing on any row.
      hint: isViewPath(entry.path) ? `${VIEW_LAYOUT_DIR} view diagram` : "file",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Reads the whole project, recursively, as the listing every row is built from. */
export async function readProjectEntries(fs: ProjectFs): Promise<Dirent[]> {
  return fs.readdir(".", { recursive: true });
}
