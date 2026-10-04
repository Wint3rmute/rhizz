// A project's address on the filesystem and in the URL is *just* the slug of
// its name: "Drone System" is served at `/projects/drone-system/…`, and
// persisted server-side as the directory `drone-system/` holding the project's
// files. So the slug is the project's identity, and it has to be unique — hence
// the duplicate check on create and rename (see ./operations).
//
// Deliberately DOM/storage free, so it is unit tested in plain Node and
// reusable by the UI (to show the address a name will get) as well as by the
// store.

/**
 * A project name that cannot be turned into an address: nothing usable is
 * left once the name is folded (blank, or only punctuation). A distinct class
 * from DuplicateProjectError so a caller can tell "unusable name" from
 * "name already taken"; the message is what the UI shows.
 */
export class InvalidProjectNameError extends Error {
  constructor(name: string) {
    super(
      `"${name}" has no characters usable in a project address ` +
        `(letters, digits and hyphens only)`,
    );
    this.name = "InvalidProjectNameError";
  }
}

/**
 * The address slug for `name`: lower-cased ASCII alphanumerics, every run of
 * anything else collapsed to a single hyphen, no leading/trailing hyphen.
 *
 * Non-ASCII letters are folded away rather than transliterated ("Übung"
 * becomes "bung") — predictable beats clever, and a user can always pick a
 * name that spells itself out.
 *
 * @throws InvalidProjectNameError when nothing usable is left.
 */
export function projectSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new InvalidProjectNameError(name);
  return slug;
}

/**
 * A slug that is already taken by another project. The slug is the project's
 * address, so a second project claiming it would collide in the URL and in the
 * server-side `&lt;slug&gt;/` directory — refused in the store, not just in the UI
 * (and, for a network backend, again on save: rhizz-server rejects a payload
 * with two projects at one id).
 */
export class DuplicateProjectError extends Error {
  constructor(slug: string, name: string) {
    super(
      `A project called "${name}" already uses the address "${slug}" — ` +
        `pick another name`,
    );
    this.name = "DuplicateProjectError";
  }
}
