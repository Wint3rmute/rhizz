// Building a new view out of what is currently selected on the canvas.
//
// The Modeling context menu's "create new view from selection" row needs three
// decisions made in one place, each of which the page must not make on its own:
// what path the typed name means, whether that view already exists (writing
// would silently overwrite it), and what a layout holding only the selection
// looks like. All three are pure, so they are unit tested here and the page
// only owns the prompt and the write.
//
// Deliberately DOM-free, like `spawnPlacement.ts`: the page owns `prompt()`,
// the filesystem and the navigation.
import type { Dirent } from "../../../../vfs/fs";
import {
  emptyDiagramLayout,
  type DiagramLayout,
  type StoredBox,
} from "./persistence";

/**
 * The path of the new view, relative to `views/`, for the name the user typed.
 *
 * `null` when the name cannot be one: blank, or a nested path. A name is one
 * path segment, since `prompt()` has no place to express nesting — that is the
 * Diagrams tree's `+ Folder`, and `NewViewModal` validates the same way.
 */
export function viewPathFromName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.includes("/")) return null;
  return trimmed.endsWith(".hcl") ? trimmed : `${trimmed}.hcl`;
}

/**
 * Whether a view file already sits at `path`. Writing there would replace it,
 * so the caller asks first — a view is a hand-arranged picture that no
 * confirmation dialog stands between the user and the loss of.
 */
export function viewPathTaken(
  entries: readonly Dirent[],
  path: string,
): boolean {
  return entries.some((entry) => entry.isFile() && entry.path === path);
}

/**
 * A layout placing only `selectedKeys`, each at the box it already has.
 *
 * Positions are copied verbatim rather than re-centered: the selection is
 * already a picture, and moving it would mean the new view and the old one
 * disagree about where things are. Connections need no copying at all — edges
 * are drawn from the model wherever both of their endpoints are placed, so a
 * connection between two selected components comes along by itself.
 */
export function layoutFromSelection(
  system: string,
  checked: Record<string, StoredBox>,
  selectedKeys: Iterable<string>,
): DiagramLayout {
  const layout = emptyDiagramLayout(system);
  for (const key of selectedKeys) {
    const box = checked[key];
    // A selected key with no box is not on the canvas, so it is not in the
    // picture either — same rule `mapLayoutToBoxes` applies to stale keys.
    if (box) layout.checked[key] = { ...box };
  }
  return layout;
}