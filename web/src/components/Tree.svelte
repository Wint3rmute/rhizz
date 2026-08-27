<script lang="ts">
// The reusable collapsible-tree shell shared by FileTree (file/diagram
// hierarchies) and ComponentHierarchyTree (the component hierarchy in the
// Diagrams sidebar). Like FileTree, it never imports ProjectFs/ProjectStore
// — it works purely on the `TreeNode[]` it's handed, so the fs.* calls and
// the data-shaping both stay with the caller. It owns only the chrome both
// trees need: expand/collapse, indentation, and single-row selection.
//
// Tree-specific chrome (icons, checkboxes, CRUD buttons, …) is injected via
// the `leading`/`rowTail` snippets, keeping the shell free of file vs.
// component knowledge. `leading` receives `(node, collapsed)` — the second
// argument lets a provider render collapsible-aware chrome (e.g. the folder
// open/closed icon).
import { SvelteSet } from "svelte/reactivity";
import type { Snippet } from "svelte";
import type { TreeNode } from "./treeTypes";

let {
  nodes,
  selectedId = $bindable(),
  leading,
  rowTail,
  emptyMessage = "Nothing here yet.",
  // Global default row spacing for every tree consumer. Override per-consumer
  // by passing rowClass="" (or another spacing, e.g. "py-1") to opt out / tune
  // a single tree only.
  rowClass = "py-1",
  showExpandCollapseAll = false,
  onselect,
}: {
  nodes: TreeNode[];
  selectedId: string | null;
  leading?: Snippet<[TreeNode, boolean]>;
  rowTail?: Snippet<[TreeNode]>;
  emptyMessage?: string;
  rowClass?: string;
  /** If true, show a "Collapse all / Expand all" toolbar above the tree. */
  showExpandCollapseAll?: boolean;
  /** Extra sole-selection hook, fired on a label click after `selectedId` is set. */
  onselect?: (entry: TreeNode) => void;
} = $props();

// Expand/collapse is purely visual state, mutated in place (a SvelteSet,
// not a rebuilt one) so per-node open/close reacts naturally.
const collapsedIds = new SvelteSet<string>();

function toggleCollapsed(id: string) {
  if (collapsedIds.has(id)) collapsedIds.delete(id);
  else collapsedIds.add(id);
}

// Every expandable node id in the tree, for the collapse-all/expand-all
// buttons. Purely derived from the input tree, so the buttons only appear
// when there's actually something to collapse/expand.
let expandableIds = $derived.by(() => {
  const collect = (entries: TreeNode[], acc: string[]) => {
    for (const entry of entries) {
      if (entry.isExpandable) acc.push(entry.id);
      collect(entry.children, acc);
    }
  };
  const acc: string[] = [];
  collect(nodes, acc);
  return acc;
});

function collapseAll() {
  for (const id of expandableIds) collapsedIds.add(id);
}

function expandAll() {
  collapsedIds.clear();
}
</script>

{#snippet node(entry: TreeNode, depth: number)}
  {@const collapsed = collapsedIds.has(entry.id)}
  <li>
    <div
      class="flex items-center gap-1 group/row rounded hover:bg-base-200 {rowClass}"
      style="padding-left: {depth * 12}px"
    >
      {#if entry.isExpandable}
        <button
          class="w-4 shrink-0 text-xs text-base-content/60"
          onclick={() => toggleCollapsed(entry.id)}
          title={collapsed ? "Expand" : "Collapse"}
        >{collapsed ? "▸" : "▾"}</button>
      {:else}
        <span class="w-4 shrink-0"></span>
      {/if}

      {#if leading}
        {@render leading(entry, collapsed)}
      {/if}

      <button
        class="flex-1 truncate text-left text-sm {selectedId === entry.id
          ? 'font-semibold text-primary'
          : ''}"
        aria-current={selectedId === entry.id ? "true" : undefined}
        onclick={() => {
          selectedId = entry.id;
          onselect?.(entry);
        }}
      >{entry.name}</button>

      {#if rowTail}
        <span class="hidden shrink-0 gap-1 group-hover/row:flex">
          {@render rowTail(entry)}
        </span>
      {/if}
    </div>
    {#if entry.isExpandable && !collapsed && entry.children.length > 0}
      <ul>
        {#each entry.children as child (child.id)}
          {@render node(child, depth + 1)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

{#if nodes.length === 0}
  <p class="text-sm text-base-content/50">{emptyMessage}</p>
{:else}
  {#if showExpandCollapseAll}
    <div class="flex gap-1 mb-1">
  <button
    class="btn btn-ghost btn-xs"
    onclick={collapseAll}
    disabled={expandableIds.length === 0}
    title="Collapse every expandable node"
  >Collapse all</button>
  <button
    class="btn btn-ghost btn-xs"
    onclick={expandAll}
    disabled={expandableIds.length === 0}
    title="Expand every expandable node"
  >Expand all</button>
</div>
  {/if}
  <ul class="text-sm space-y-1">
    {#each nodes as entry (entry.id)}
      {@render node(entry, 0)}
    {/each}
  </ul>
{/if}
