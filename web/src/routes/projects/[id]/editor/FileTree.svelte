<script lang="ts">
// The editor's file-tree sidebar. Talks to the page only through paths
// (a Dirent[] listing in, a selected path bound out, and callback props
// for the CRUD actions) — it never imports ProjectFs/ProjectStore itself,
// so the actual fs.* calls (and their error handling) stay owned by
// +page.svelte, matching how the rest of this app keeps I/O out of
// presentation components.
import { SvelteSet } from "svelte/reactivity";
import type { Dirent } from "../../../../vfs/fs";
import { buildPathTree, type PathTreeNode } from "../../../../vfs/pathTree";
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

let tree = $derived(buildPathTree(entries));

// Directories start expanded; collapsing is opt-in per path. A real,
// mutated-in-place Set (not a throwaway one rebuilt by a $derived), so
// SvelteMap/SvelteSet's own reactivity is what's needed here.
let collapsedPaths = new SvelteSet<string>();

function toggleCollapsed(path: string) {
  if (collapsedPaths.has(path)) collapsedPaths.delete(path);
  else collapsedPaths.add(path);
}
</script>

{#snippet node(entry: PathTreeNode, depth: number)}
  <li>
    <div
      class="flex items-center gap-1 group/row rounded hover:bg-base-200"
      style="padding-left: {depth * 12}px"
    >
      {#if entry.isDirectory}
        <button
          class="w-4 shrink-0 text-xs text-base-content/60"
          onclick={() => toggleCollapsed(entry.path)}
          title={collapsedPaths.has(entry.path) ? "Expand" : "Collapse"}
        >{collapsedPaths.has(entry.path) ? "▸" : "▾"}</button>
        <svg
          viewBox="0 0 {collapsedPaths.has(entry.path) ? folderIcon.width : folderOpenIcon.width} {collapsedPaths.has(entry.path) ? folderIcon.height : folderOpenIcon.height}"
          class="w-3.5 h-3.5 shrink-0 fill-current text-warning/80"
          aria-hidden="true"
        >
          <path d={collapsedPaths.has(entry.path) ? folderIcon.svgPath : folderOpenIcon.svgPath} />
        </svg>
        <span class="flex-1 truncate text-sm font-medium">{entry.name}</span>
      {:else}
        <span class="w-4 shrink-0"></span>
        <svg
          viewBox="0 0 {fileCodeIcon.width} {fileCodeIcon.height}"
          class="w-3.5 h-3.5 shrink-0 fill-current text-base-content/50"
          aria-hidden="true"
        >
          <path d={fileCodeIcon.svgPath} />
        </svg>
        <button
          class="flex-1 truncate text-left text-sm {selectedPath ===
            entry.path
            ? 'font-semibold text-primary'
            : ''}"
          aria-current={selectedPath === entry.path ? "true" : undefined}
          onclick={() => (selectedPath = entry.path)}
        >{entry.name}</button>
      {/if}

      {#if oncreatefile || oncreatedirectory || onrename || ondelete}
        <span
          class="hidden shrink-0 gap-1 group-hover/row:flex"
        >
          {#if entry.isDirectory}
            {#if oncreatefile}
              <button
                class="text-xs text-base-content/60 hover:text-base-content"
                title="New file"
                onclick={() => oncreatefile(entry.path)}
              >+📄</button>
            {/if}
            {#if oncreatedirectory}
              <button
                class="text-xs text-base-content/60 hover:text-base-content"
                title="New folder"
                onclick={() => oncreatedirectory(entry.path)}
              >+📁</button>
            {/if}
          {/if}
          {#if onrename}
            <button
              class="text-xs text-base-content/60 hover:text-base-content"
              title="Rename"
              onclick={() => onrename(entry.path)}
            >✎</button>
          {/if}
          {#if ondelete}
            <button
              class="text-xs text-base-content/60 hover:text-error"
              title="Delete"
              onclick={() => ondelete(entry.path)}
            >🗑</button>
          {/if}
        </span>
      {/if}
    </div>
    {#if entry.isDirectory && !collapsedPaths.has(entry.path)}
      <ul>
        {#each entry.children as child (child.path)}
          {@render node(child, depth + 1)}
        {/each}
      </ul>
    {/if}
  </li>
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
  {#if tree.length === 0}
    <p class="text-sm text-base-content/50">No files yet.</p>
  {:else}
    <ul class="text-sm">
      {#each tree as entry (entry.path)}
        {@render node(entry, 0)}
      {/each}
    </ul>
  {/if}
</div>
