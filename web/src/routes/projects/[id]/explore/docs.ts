// Schema + loading for the Markdown "knowledge database" persisted into the
// active project's VFS under `docs/` (mirroring how diagram layouts live under
// `diagrams/`). Each `.md` file's path (minus the `.md` suffix) is the key
// that associates it with a component's label, e.g. `docs/product.md` ↔
// component label `product`.
import { type ProjectFs } from "../../../../vfs/fs";

// Conventional location for Markdown docs inside a project's VFS.
export const DOCS_DIR = "docs";

// A single doc: its key (path minus `.md`) and its raw Markdown content.
export interface ProjectDoc {
  key: string;
  content: string;
}

// Reads every ".md" file under `docs/` (recursively) into a list of docs,
// keyed by path minus the ".md" suffix. Missing docs directory yields an empty
// list rather than erroring.
export async function readProjectDocs(fs: ProjectFs): Promise<ProjectDoc[]> {
  let entries;
  try {
    entries = await fs.readdir(DOCS_DIR, { recursive: true });
  } catch {
    return [];
  }

  const mdPaths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.path);

  return Promise.all(
    mdPaths.map(async (path) => ({
      key: path.endsWith(".md") ? path.slice(0, -3) : path,
      // `readdir` returns paths relative to `DOCS_DIR`, but `readFile` resolves
      // relative to the project root, so re-prefix before reading.
      content: await fs.readFile(`${DOCS_DIR}/${path}`),
    })),
  );
}
