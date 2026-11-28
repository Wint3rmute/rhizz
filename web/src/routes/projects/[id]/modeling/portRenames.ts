// Re-keys per-view port state after a `rename_port` model op.
//
// Views key a port by its label under its node (`port "<label>" { side,
// visible }`), so a renamed port would otherwise silently lose its outline
// spot and its shown-when-unconnected flag. The model op reports which placed
// components changed (`PortRename`); the open view's in-memory state is
// re-keyed with the two pure helpers here (its own save effect writes it), and
// every other view file is rewritten through rhizome-core's
// `rename_ports_in_views`, so the rule lives in one place.
import type { ProjectFs } from "../../../../vfs/fs";
import {
  type PortRename,
  rename_ports_in_views,
} from "../../../../rhizome_wasm_wrapper";
import { rewriteOtherViewFiles } from "./viewFiles";

/** `byComponent` with each renamed port's entry moved to its new label. A
 * component already holding the new label keeps its own entry. */
export function renamePortSpots<T>(
  byComponent: Readonly<Record<string, Readonly<Record<string, T>>>>,
  renames: readonly PortRename[],
): Record<string, Record<string, T>> {
  const result: Record<string, Record<string, T>> = Object.fromEntries(
    Object.entries(byComponent).map(([key, byPort]) => [key, { ...byPort }]),
  );
  for (const { component, from, to } of renames) {
    const byPort = result[component];
    if (byPort === undefined || !(from in byPort) || to in byPort) continue;
    const { [from]: moved, ...rest } = byPort;
    result[component] = { ...rest, [to]: moved as T };
  }
  return result;
}

/** `visiblePorts` with each renamed port's label replaced. */
export function renameVisiblePorts(
  visiblePorts: Readonly<Record<string, readonly string[]>>,
  renames: readonly PortRename[],
): Record<string, string[]> {
  const result: Record<string, string[]> = Object.fromEntries(
    Object.entries(visiblePorts).map(([key, labels]) => [key, [...labels]]),
  );
  for (const { component, from, to } of renames) {
    const labels = result[component];
    if (labels === undefined || labels.includes(to)) continue;
    result[component] = labels.map((label) => (label === from ? to : label));
  }
  return result;
}

/**
 * Rewrites every view file except `skipPath` (the open view, whose state the
 * caller re-keys in memory) so its `port` blocks follow `renames`. Returns the
 * previous content of each rewritten file (see `rewriteOtherViewFiles`).
 */
export async function renamePortsInViewFiles(
  fs: ProjectFs,
  renames: readonly PortRename[],
  skipPath: string | null,
): Promise<Map<string, string>> {
  if (renames.length === 0) return new Map();
  return rewriteOtherViewFiles(fs, skipPath, "rename_port", (before) =>
    rename_ports_in_views(before, renames),
  );
}
