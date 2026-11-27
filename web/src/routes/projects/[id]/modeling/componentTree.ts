// Builds the nested component-hierarchy tree the Diagrams sidebar renders,
// from the flat `systems`/`components` arrays the WASM model exposes.
// Mirrors the file-tree's `buildPathTree` contract (vfs/pathTree.ts): a pure
// flat-array → nested `TreeNode[]` translation with no I/O, so it can be unit
// tested in isolation and rendered by the shared `Tree` shell.
//
// Hierarchy is derived from the arena-index parent links on each component:
// a component whose `parent_component_index` is set nests under that
// component; otherwise its `parent_system_index` places it directly under a
// top-level system. Roots are the systems themselves.
import type { TreeNode } from "../../../../components/treeTypes";

/**
 * Minimal structural shape of a system, as exposed by the WASM model.
 */
export interface ComponentTreeSystem {
  label: string;
}

/**
 * Minimal structural shape of a component, as exposed by the WASM model.
 */
export interface ComponentTreeComponent {
  label: string;
  /** Arena index of the parent component, if this component is nested. */
  parent_component_index?: number | undefined;
  /** Arena index of the parent system, if this component is top-level. */
  parent_system_index?: number | undefined;
  /** Optional icon name for rendering. */
  icon?: string | undefined;
}

/**
 * Resolves the top-level system index a component belongs to by walking
 * `parent_component_index` links until a `parent_system_index` is found.
 * Returns undefined for orphans with no system link.
 */
export function systemIndexOfComponent(
  components: ComponentTreeComponent[],
  index: number,
): number | undefined {
  let current = components[index];
  const seen = new Set<number>();
  while (current !== undefined) {
    if (current.parent_system_index !== undefined) {
      return current.parent_system_index;
    }
    const parent = current.parent_component_index;
    if (parent === undefined || seen.has(parent)) return undefined;
    seen.add(parent);
    current = components[parent];
  }
  return undefined;
}

/**
 * True when the component at `index` belongs (transitively) to `systemIndex`.
 */
export function componentInSystem(
  components: ComponentTreeComponent[],
  index: number,
  systemIndex: number,
): boolean {
  return systemIndexOfComponent(components, index) === systemIndex;
}

/** Labels of the ports declared on the component at an arena index. */
export type PortsOf = (index: number) => readonly string[];

const PORT_ROW_PREFIX = "port:";

/** Tree id of the "Ports (n)" group row of the component at `index`. */
export function portGroupId(index: number): string {
  return `ports:${String(index)}`;
}

/** Tree id of the row for port `label` on the component at `index`. */
export function portRowId(index: number, label: string): string {
  return `${PORT_ROW_PREFIX}${String(index)}:${label}`;
}

/** Inverse of {@link portRowId}; `null` for component and system rows. */
export function parsePortRowId(
  id: string,
): { index: number; label: string } | null {
  if (!id.startsWith(PORT_ROW_PREFIX)) return null;
  const rest = id.slice(PORT_ROW_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon === -1) return null;
  const index = Number(rest.slice(0, colon));
  if (!Number.isInteger(index)) return null;
  return { index, label: rest.slice(colon + 1) };
}

/**
 * Builds the `TreeNode[]` for a single system only, hiding the system root
 * itself — returns its top-level components (and their subtrees) as roots.
 * Used by the Modeling explorer when a view is bound to one system.
 */
export function buildSystemSubtree(
  systems: ComponentTreeSystem[],
  components: ComponentTreeComponent[],
  systemLabel: string,
  portsOf?: PortsOf,
): TreeNode[] {
  const systemIndex = systems.findIndex((s) => s.label === systemLabel);
  if (systemIndex === -1) return [];
  return (
    buildComponentTree(systems, components, portsOf).find(
      (n) => n.id === `sys:${String(systemIndex)}`,
    )?.children ?? []
  );
}

/**
 * Builds the `TreeNode[]` for the whole model.
 *
 * All component nodes are created first (each with an initially-empty
 * `children` array, keyed by arena index), then a second pass attaches each
 * component to its parent's `children`. Two passes guarantee a parent node
 * exists to receive its children regardless of the order components arrive
 * in — the same invariant `buildPathTree` guarantees by depth-sorting.
 *
 * Ordering is deterministic: systems in model order, each system's direct
 * components in model order, and each component's children in model order,
 * matching how the canvas renders sibling components. Component nodes are
 * keyed by their arena index (unique across the model — component labels are
 * only unique within a parent scope, SPEC.md §2.3); systems by `sys:<index>`.
 */
export function buildComponentTree(
  systems: ComponentTreeSystem[],
  components: ComponentTreeComponent[],
  portsOf?: PortsOf,
): TreeNode[] {
  const orphanRoots: TreeNode[] = [];

  // Pass 1 — materialize every node so parents exist before child attachment.
  const componentNodeByIndex = new Map<number, TreeNode>();
  components.forEach((component, index) => {
    componentNodeByIndex.set(index, {
      id: String(index),
      name: component.label,
      isExpandable: false,
      children: [],
    });
  });

  const systemNodes: TreeNode[] = systems.map((system, index) => ({
    id: `sys:${String(index)}`,
    name: system.label,
    isExpandable: false,
    children: [],
  }));
  const systemNodeByIndex = new Map(
    systemNodes.map((node, index) => [index, node]),
  );

  // Pass 2 — attach each component to its parent, remapping the parent link
  // (arena index) to the already-created node. Unparented components are
  // collected into orphanRoots below.
  components.forEach((component, index) => {
    const node = componentNodeByIndex.get(index);
    if (node === undefined) return; // unreachable: pass 1 created every index
    let parentChildren: TreeNode[] | undefined;

    if (component.parent_component_index !== undefined) {
      parentChildren = componentNodeByIndex.get(
        component.parent_component_index,
      )?.children;
    } else if (component.parent_system_index !== undefined) {
      parentChildren = systemNodeByIndex.get(
        component.parent_system_index,
      )?.children;
    }

    if (parentChildren) {
      parentChildren.push(node);
    } else {
      orphanRoots.push(node);
    }
  });

  // Pass 3 — a component's declared ports become leaf rows, grouped under a
  // collapsed "Ports (n)" row after its subcomponents, so the tree can toggle
  // their visibility per view without crowding the hierarchy.
  if (portsOf !== undefined) {
    componentNodeByIndex.forEach((node, index) => {
      const labels = portsOf(index);
      if (labels.length === 0) return;
      node.children.push({
        id: portGroupId(index),
        name: `Ports (${String(labels.length)})`,
        isExpandable: true,
        initiallyCollapsed: true,
        children: labels.map((label) => ({
          id: portRowId(index, label),
          name: label,
          isExpandable: false,
          children: [],
        })),
      });
    });
  }

  // Pass 4 — set the expandable flag from actual child counts, so a composite
  // nested component, or one with ports, shows an expand/collapse toggle.
  const markExpandability = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      node.isExpandable = node.children.length > 0;
      markExpandability(node.children);
    }
  };
  markExpandability(systemNodes);
  markExpandability(orphanRoots);

  return [...systemNodes, ...orphanRoots];
}
