<script lang="ts">
// The component-hierarchy sidebar for the Diagrams editor. Reuses the shared
// `Tree` shell to render the nested component tree with expand/collapse,
// mirroring how FileTree renders file/diagram hierarchies.
//
// Each row is a placement-affordance let loose from the canvas:
//   - a checkbox to place/unplace the component on the canvas,
//   - a label that selects the node (drives the canvas highlight +
//     NodeInspector, synced through the `selected` SvelteSet),
//   - a component icon when one is provided.
// It does no I/O and owns no model state — everything is passed in, so all
// readProjectSources/compile/write logic stays in +page.svelte.
import type { SvelteSet } from "svelte/reactivity";
import Tree from "../../../../components/Tree.svelte";
import type { TreeNode } from "../../../../components/treeTypes";
import { resolveIcon } from "../../../../iconHelper";
import {
  buildComponentTree,
  type ComponentTreeComponent,
  type ComponentTreeSystem,
} from "./componentTree";

let {
  systems,
  components,
  selected,
  onToggleChecked,
  isChecked,
}: {
  systems: ComponentTreeSystem[];
  components: ComponentTreeComponent[];
  /** The canvas node selection (arena-index set); mutated in place for two-way sync. */
  selected?: SvelteSet<number>;
  /** True when the given arena index is currently placed on the canvas. */
  isChecked: (index: number) => boolean;
  /** Fired when a row's checkbox is toggled; +page.svelte places/unplaces it. */
  onToggleChecked: (index: number) => void;
} = $props();

let nodes = $derived(buildComponentTree(systems, components));

// The `Tree` shell highlights a single `selectedId`. Map it to/from the
// canvas's multi-select SvelteSet: when exactly one component is selected,
// that component's row is highlighted; clicking a row collapses the set to
// just that component (matching the canvas's click-to-single-select).
let selectedIndex = $derived(
  selected && selected.size === 1
    ? String(selected.values().next().value!)
    : null,
);

function onSelectComponent(entry: TreeNode) {
  if (!selected) return;
  const index = nodeIndex(entry);
  if (index === null) return;
  selected.clear();
  selected.add(index);
}

function nodeIndex(entry: TreeNode): number | null {
  // Only component rows have numeric ids; system roots start with "sys:".
  if (entry.id.startsWith("sys:")) return null;
  const n = Number(entry.id);
  return Number.isNaN(n) ? null : n;
}
</script>

{#snippet compLeading(entry: TreeNode)}
  {@const index = nodeIndex(entry)}
  {@const icon = index !== null ? resolveIcon(components[index]?.icon ?? "") : null}
  {#if index !== null}
    <input
  type="checkbox"
  class="checkbox checkbox-xs shrink-0"
  checked={isChecked(index)}
  onchange={() => onToggleChecked(index)}
/>
  {:else}
    <span class="w-4 shrink-0"></span>
  {/if}
  {#if icon}
    <svg
  viewBox={`0 0 ${icon.width} ${icon.height}`}
  class="w-3.5 h-3.5 shrink-0 fill-current text-base-content/60"
  aria-hidden="true"
>
  <path d={icon.svgPath} />
</svg>
  {/if}
{/snippet}

<Tree
  {nodes}
  bind:selectedId={selectedIndex}
  emptyMessage="No components found."
  rowClass="py-1.5"
  showExpandCollapseAll
  leading={compLeading}
  onselect={onSelectComponent}
/>
