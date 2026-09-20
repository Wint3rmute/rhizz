<script lang="ts">
// The editor's file-tree sidebar — now a thin adapter over the reusable
// `Tree` shell. Talks to the page only through paths (a Dirent[] listing in,
// a selected path bound out, and callback props for the CRUD actions) — it
// never imports ProjectFs/ProjectStore itself, so the actual fs.* calls (and
// their error handling) stay owned by +page.svelte, matching how the rest of
// this app keeps I/O out of presentation components.
import type { Dirent } from "../../../../vfs/fs";
import { buildPathTree, type PathTreeNode } from "../../../../vfs/pathTree";
import Tree from "../../../../components/Tree.svelte";
import type { TreeNode } from "../../../../components/treeTypes";
import {
  fileCodeIcon,
  folderIcon,
  folderOpenIcon,
} from "../../../../iconHelper";

let {
  entries,
  selectedPath = $bindable(),
  oncreatefile,
  oncreatedirectory,
  onrename,
  ondelete,
}: {
  entries: Dirent[];
  selectedPath: string | null;
  /** `parentPath` is "" for the project root. */
  oncreatefile?: (parentPath: string) => void;
  /** `parentPath` is "" for the project root. */
  oncreatedirectory?: (parentPath: string) => void;
  onrename?: (path: string) => void;
  ondelete?: (path: string) => void;
} = $props();

// Shallow-adapt the path tree built by buildPathTree into the shell's
// generic TreeNode[] shape. `id` is the entry's full path (unique across the
// whole tree); `isExpandable` is `isDirectory` — a directory with no
// children still shows an expand/collapse button, mirroring the original
// FileTree's unconditional folder toggle.
function toTreeNode(n: PathTreeNode): TreeNode {
  return {
    id: n.path,
    name: n.name,
    isExpandable: n.isDirectory,
    children: n.children.map(toTreeNode),
  };
}

let nodes = $derived(buildPathTree(entries).map(toTreeNode));
</script>

{#snippet fileLeading(entry: TreeNode, collapsed: boolean)}
  {#if entry.isExpandable}
    <svg
  viewBox={`0 0 ${collapsed ? folderIcon.width : folderOpenIcon.width} ${collapsed ? folderIcon.height : folderOpenIcon.height}`}
  class="w-3.5 h-3.5 shrink-0 fill-current text-warning/80"
  aria-hidden="true"
>
  <path d={collapsed ? folderIcon.svgPath : folderOpenIcon.svgPath} />
</svg>
  {:else}
    <svg
  viewBox={`0 0 ${fileCodeIcon.width} ${fileCodeIcon.height}`}
  class="w-3.5 h-3.5 shrink-0 fill-current text-base-content/50"
  aria-hidden="true"
>
  <path d={fileCodeIcon.svgPath} />
</svg>
  {/if}
{/snippet}

{#snippet fileRowTail(entry: TreeNode)}
  {#if oncreatefile || oncreatedirectory || onrename || ondelete}
    {#if entry.isExpandable}
      {#if oncreatefile}
        <button
  class="text-xs text-base-content/60 hover:text-base-content"
  title="New file"
  onclick={() => oncreatefile(entry.id)}
>+📄</button>
      {/if}
      {#if oncreatedirectory}
        <button
  class="text-xs text-base-content/60 hover:text-base-content"
  title="New folder"
  onclick={() => oncreatedirectory(entry.id)}
>+📁</button>
      {/if}
    {/if}
    {#if onrename}
      <button
  class="text-xs text-base-content/60 hover:text-base-content"
  title="Rename"
  onclick={() => onrename(entry.id)}
>✎</button>
    {/if}
    {#if ondelete}
      <button
  class="text-xs text-base-content/60 hover:text-error"
  title="Delete"
  onclick={() => ondelete(entry.id)}
>🗑</button>
    {/if}
  {/if}
{/snippet}

<div class="flex flex-col gap-2">
  {#if oncreatefile || oncreatedirectory}
    <div class="flex gap-2">
      {#if oncreatefile}
        <button
          class="btn btn-ghost btn-xs"
          onclick={() => oncreatefile("")}
        >+ File</button>
      {/if}
      {#if oncreatedirectory}
        <button
          class="btn btn-ghost btn-xs"
          onclick={() => oncreatedirectory("")}
        >+ Folder</button>
      {/if}
    </div>
  {/if}

  <Tree
    {nodes}
    bind:selectedId={selectedPath}
    emptyMessage="No files yet."
    leading={fileLeading}
    rowTail={fileRowTail}
  />
</div>
