// Rewrites the view files a model rename affects (`rename_port`,
// `rename_connection`). The open view is re-keyed in memory by its caller
// (its own save effect writes it); every other view file is rewritten here
// through a rhizome-core helper, so the re-keying rule lives in one place.
import type { ProjectFs } from "../../../../vfs/fs";
import { VIEW_LAYOUT_DIR } from "./persistence";

/**
 * Applies `rewrite` to every view file except `skipPath`. `rewrite` returns the
 * new content, or `undefined` when the file needs no change.
 *
 * Returns the previous content of each file it rewrote, keyed by path, so an
 * undo can put them back. A view that does not parse (`rewrite` throws) is
 * left as it is: it is already broken, and the model write this follows has
 * landed. `op` names the rename in the warning.
 */
export async function rewriteOtherViewFiles(
  fs: ProjectFs,
  skipPath: string | null,
  op: string,
  rewrite: (content: string) => string | undefined,
): Promise<Map<string, string>> {
  const previous = new Map<string, string>();
  let entries;
  try {
    entries = await fs.readdir(VIEW_LAYOUT_DIR, { recursive: true });
  } catch {
    return previous; // No views directory: nothing to re-key.
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".hcl")) continue;
    const path = `${VIEW_LAYOUT_DIR}/${entry.path}`;
    if (path === skipPath) continue;
    const before = await fs.readFile(path);
    let after: string | undefined;
    try {
      after = rewrite(before);
    } catch (error) {
      console.warn(`${op}: left ${path} as it is`, error);
      continue;
    }
    if (after === undefined) continue;
    await fs.writeFile(path, after);
    previous.set(path, before);
  }
  return previous;
}
