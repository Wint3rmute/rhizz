// What the palette offers, given which page you are standing on.
//
// One palette, but not one fixed list: the *file* section narrows to the
// thing the page is actually about. On Modeling and Explore, which are both
// "which diagram?", a row for `system.hcl` would open text where the user
// asked for a canvas. On Inventory, the entities are worth a section of
// their own.
//
// The page switches are always offered regardless — they are how you leave a
// page, so a palette that only showed what the current page was about would
// have no way out of it.
//
// Read off the pathname's third segment (`/projects/<id>/<subpage>/…`),
// the same idiom the e2e helpers use. A project's id is the slug of its
// name, so `/projects/explore` is a *project* named explore and has no
// subpage at all — which is why the segment is positional rather than a
// search for a name anywhere in the path.

/** What the Files section lists. */
export type FileScope = "views" | "all";

export interface PaletteScope {
  files: FileScope;
  /** Whether the model's definitions get their own section (Inventory only). */
  inventory: boolean;
}

const VIEWS_PAGES = new Set(["modeling", "explore"]);

export function paletteScopeForPath(pathname: string): PaletteScope {
  const subpage = pathname.split("/")[3] ?? "";
  if (VIEWS_PAGES.has(subpage)) return { files: "views", inventory: false };
  if (subpage === "inventory") return { files: "all", inventory: true };
  return { files: "all", inventory: false };
}
