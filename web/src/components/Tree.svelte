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
  onselect,
}: {
  nodes: TreeNode[];
  selectedId: string | null;
  leading?: Snippet<[TreeNode, boolean]>;
  rowTail?: Snippet<[TreeNode]>;
  emptyMessage?: string;
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
</script>

{#snippet node(entry: TreeNode, depth: number)}
  {@const collapsed = collapsedIds.has(entry.id)}
  <li>
    <div
      class="flex items-center gap-1 group/row rounded hover:bg-base-200"
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
  <ul class="text-sm">
    {#each nodes as entry (entry.id)}
      {@render node(entry, 0)}
    {/each}
  </ul>
{/if}
