// Pure helpers for the Inventory subpage: filtering/searching the definition
// list and deriving the per-card badges (completion, hierarchy level).
//
// Deliberately dependency-free so the logic is unit-testable in isolation and
// reusable by both the page component and its Storybook stories.

/** Where a component's default (per-component) diagram lives in the VFS. */
export const DEFAULT_DIAGRAM_DIR = "diagrams";

/** The VFS path of a definition's default diagram: `diagrams/<label>.hcl`. */
export function defaultDiagramPath(label: string): string {
  return `${DEFAULT_DIAGRAM_DIR}/${label}.hcl`;
}

/** A port flattened into plain display data for the Inventory. */
export interface PortInfo {
  label: string;
  protocol: string;
  role: string;
  external: boolean;
  required: boolean;
  description: string;
}

/** A component definition flattened into plain display data. Instances are
 * never represented here — the Inventory lists definitions only. */
export interface InventoryDefinition {
  label: string;
  description: string;
  tags: string[];
  level: number;
  leaf: boolean;
  children: InventoryDefinition[];
  ports: PortInfo[];
  icon?: string | undefined;
  color?: string | undefined;
  border?: string | undefined;
  font?: string | undefined;
}

/** Sidebar filter tabs. `Interfaces` is a placeholder — no interface entities
 * exist in the model yet, so it always yields an empty list. */
export enum InventoryTab {
  All = "all",
  Components = "components",
  Interfaces = "interfaces",
}

/** Sidebar tabs in display order. */
export const INVENTORY_TABS: readonly InventoryTab[] = [
  InventoryTab.All,
  InventoryTab.Components,
  InventoryTab.Interfaces,
];

/** Recomputes the definition's hierarchy depth: 1 for a bare definition,
 * +1 per level of nested children. Drives the `L1`/`L2`/… badge. */
export function definitionDepth(def: InventoryDefinition): number {
  let maxChild = 0;
  for (const child of def.children) {
    maxChild = Math.max(maxChild, definitionDepth(child));
  }
  return 1 + maxChild;
}

/** The completion badge shown on a definition card. */
export type CompletionBadge =
  | { kind: "specified"; percent: 100 }
  | { kind: "partial"; percent: number }
  | { kind: "draft"; percent: 0 };

/**
 * Derives a per-definition completion badge, mirroring `rhizz-core`'s
 * documented `score_component` semantics (a leaf is complete iff it has a
 * description; ports are optional detail; a composite is complete iff all
 * children are complete). `rhizz-wasm` only exposes aggregate category
 * scores, so this is computed locally from the definition tree.
 */
export function completionBadge(def: InventoryDefinition): CompletionBadge {
  const score = completionScore(def);
  const percent = Math.round(score * 100);
  if (percent >= 100) return { kind: "specified", percent: 100 };
  if (percent > 0) return { kind: "partial", percent };
  return { kind: "draft", percent: 0 };
}

// Scores a definition subtree as 0 / 0.5 / 1.0, exactly like `score_component`
// in crates/rhizz-core/src/score.rs.
function completionScore(def: InventoryDefinition): number {
  if (def.leaf) {
    return def.description.trim().length > 0 ? 1 : 0.5;
  }
  if (def.children.length === 0) return 0;
  const allComplete = def.children.every((c) => completionScore(c) === 1);
  return allComplete ? 1 : 0.5;
}

/** Case-insensitive substring match of `query` against a definition's label,
 * description, and tags. */
function matchesQuery(def: InventoryDefinition, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (def.label.toLowerCase().includes(q)) return true;
  if (def.description.toLowerCase().includes(q)) return true;
  return def.tags.some((tag) => tag.toLowerCase().includes(q));
}

/** Filters the definition list for the sidebar: tab selection + free-text
 * search. Definitions (components) appear on `All` and `Components`;
 * `Interfaces` yields an empty list until interface entities exist. */
export function filterDefinitions(
  definitions: InventoryDefinition[],
  options: { tab: InventoryTab; query: string },
): InventoryDefinition[] {
  const { tab, query } = options;
  if (tab === InventoryTab.Interfaces) return [];
  return definitions.filter((d) => matchesQuery(d, query));
}
