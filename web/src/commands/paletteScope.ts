// What the palette offers, given which page you are standing on.
//
// One palette, but not one fixed list: the *file* section narrows to the
// thing the page is actually about. On Modeling and Explore, which are both
// "which diagram?", a row for `system.hcl` would open text where the user
// asked for a canvas. On Inventory, which is about the model's definitions,
// the files drop out entirely — the page switches and the definitions are
// the two answers it can give, and a file row is a third thing to search
// that lands the user on some other page entirely.
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

/**
 * What the Files section lists: every file, only the diagrams, or none of
 * them.
 *
 * `none` is not a narrower `views` — it is the section being absent, which
 * is why it is a scope rather than a boolean next to one. A page that lists
 * no files still offers the palette, so the section has to be able to say
 * so.
 */
export type FileScope = "none" | "views" | "all";

export interface PaletteScope {
  files: FileScope;
  /** Whether the model's definitions get their own section (Inventory only). */
  inventory: boolean;
}

const VIEWS_PAGES = new Set(["modeling", "explore"]);

export function paletteScopeForPath(pathname: string): PaletteScope {
  const subpage = pathname.split("/")[3] ?? "";
  if (VIEWS_PAGES.has(subpage)) return { files: "views", inventory: false };
  if (subpage === "inventory") return { files: "none", inventory: true };
  return { files: "all", inventory: false };
}
