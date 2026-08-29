import type { Dirent } from "../../../../vfs/fs";

function withoutHclSuffix(value: string): string {
  return value.endsWith(".hcl") ? value.slice(0, -4) : value;
}

/**
 * Resolves the conventional detail diagram for a component. Qualified paths
 * win over bare labels when both are available, avoiding ambiguity between
 * identically-named components in different parts of a system.
 */
export function findComponentDiagram(
  entries: Dirent[],
  componentLabel: string,
  qualifiedPath: string,
): Dirent | undefined {
  return entries.find(
    (entry) => withoutHclSuffix(entry.path) === qualifiedPath,
  ) ?? entries.find(
    (entry) => withoutHclSuffix(entry.name) === componentLabel,
  );
}

export function diagramTitle(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name.endsWith(".hcl") ? name.slice(0, -4) : name;
}
