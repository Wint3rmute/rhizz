// Re-keys per-view connection state after a `rename_connection` model op.
//
// Views key a connection by its name within their system (`connection
// "<label>" { hidden }`), so a renamed connection would otherwise silently
// lose its hidden state. The model op reports which systems hold a copy of it
// (`ConnectionRename`); the open view's in-memory state is re-keyed with the
// pure helper here, and every other view file is rewritten through
// rhizome-core's `rename_connections_in_views`.
import type { ProjectFs } from "../../../../vfs/fs";
import {
  type ConnectionRename,
  rename_connections_in_views,
} from "../../../../rhizome_wasm_wrapper";
import { rewriteOtherViewFiles } from "./viewFiles";

/** `byLabel` (a view's `savedConnections`) with each rename that applies to
 * `system` moved to its new label. A label already holding an entry keeps it. */
export function renameSavedConnections<T>(
  byLabel: Readonly<Record<string, T>>,
  renames: readonly ConnectionRename[],
  system: string,
): Record<string, T> {
  let result: Record<string, T> = { ...byLabel };
  for (const { systems, from, to } of renames) {
    if (!systems.includes(system) || !(from in result) || to in result) {
      continue;
    }
    const { [from]: moved, ...rest } = result;
    result = { ...rest, [to]: moved as T };
  }
  return result;
}

/**
 * Rewrites every view file except `skipPath` (the open view) so its
 * `connection` blocks follow `renames`. Returns the previous content of each
 * rewritten file, for undo.
 */
export async function renameConnectionsInViewFiles(
  fs: ProjectFs,
  renames: readonly ConnectionRename[],
  skipPath: string | null,
): Promise<Map<string, string>> {
  if (renames.length === 0) return new Map();
  return rewriteOtherViewFiles(fs, skipPath, "rename_connection", (before) =>
    rename_connections_in_views(before, renames),
  );
}
