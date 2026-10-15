<script lang="ts">
  // The component-hierarchy sidebar for Modeling. Reuses the shared
  // `Tree` shell to render the nested component tree with expand/collapse,
  // mirroring how FileTree renders file/diagram hierarchies.
  //
  // Each row is a placement-affordance let loose from the canvas:
  //   - a checkbox to place/unplace the component on the canvas,
  //   - a label that selects the node (drives the canvas highlight +
  //     NodeInspector, all driven by ModelingPage's selection),
  //   - a component icon when one is provided.
  // It does no I/O and owns no model state — everything is passed in, so all
  // readProjectSources/compile/write logic stays in ModelingPage.svelte.
  import Tree from "../../../../components/Tree.svelte";
  import type { TreeNode } from "../../../../components/treeTypes";
  import { resolveIcon } from "../../../../iconHelper";
  import {
    buildComponentTree,
    buildSystemSubtree,
    type ComponentTreeComponent,
    type ComponentTreeSystem,
  } from "./componentTree";

  let {
    systems,
    components,
    selected,
    onSelectComponent,
    onToggleChecked,
    isChecked,
    filterSystemLabel = null,
  }: {
    systems: ComponentTreeSystem[];
    components: ComponentTreeComponent[];
    /** The canvas node selection (arena indices). Read-only: changes go through `onSelectComponent`. */
    selected: ReadonlySet<number>;
    /** Fired when a component row is clicked; ModelingPage.svelte makes it the sole selection. */
    onSelectComponent: (index: number) => void;
    /** When set, only this system's subtree is shown and the system root row is hidden. */
    filterSystemLabel?: string | null;
    /** True when the given arena index is currently placed on the canvas. */
    isChecked: (index: number) => boolean;
    /** Fired when a row's checkbox is toggled; ModelingPage.svelte places/unplaces it. */
    onToggleChecked: (index: number) => void;
  } = $props();

  let nodes = $derived(
    filterSystemLabel
      ? buildSystemSubtree(systems, components, filterSystemLabel)
      : buildComponentTree(systems, components),
  );

  // The `Tree` shell highlights a single `selectedId`. When exactly one
  // component is selected, that component's row is highlighted.
  let selectedIndex = $derived(
    selected.size === 1 ? String(selected.values().next().value ?? "") : null,
  );

  function onSelectRow(entry: TreeNode) {
    const index = nodeIndex(entry);
    if (index === null) return;
    onSelectComponent(index);
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
  {@const icon =
    index !== null ? resolveIcon(components[index]?.icon ?? "") : null}
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
  showExpandCollapseAll
  leading={compLeading}
  onselect={onSelectRow}
/>
