import { componentKeyAt } from "../../../../modelKeys";
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

/** Indexes of components that have a detail diagram in `entries`. */
export function linkedComponentIndexes(
  components: { label: string }[],
  componentKeys: string[],
  entries: Dirent[],
): Set<number> {
  const linked = new Set<number>();
  components.forEach((component, index) => {
    const diagram = findComponentDiagram(
      entries,
      component.label,
      componentKeyAt(componentKeys, index),
    );
    if (diagram) linked.add(index);
  });
  return linked;
}
