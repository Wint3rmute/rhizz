<script lang="ts">
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { page } from "$app/state";
import {
  getCurrentProjectId,
  projectStore,
} from "../../../../ProjectState.svelte";
import { type Dirent, openProjectFs } from "../../../../vfs/fs";
import FileTree from "../code/FileTree.svelte";
import DiagramViewer from "../modeling/DiagramViewer.svelte";
import EmbedDiagramButton from "../modeling/EmbedDiagramButton.svelte";
import {
  readDiagramLayoutFile,
  VIEW_LAYOUT_DIR,
} from "../modeling/persistence";
import { TOUR_TARGETS } from "../../../../tour/tourTargets";

let {
  projectId = null,
  embedBaseUrl = null,
}: {
  projectId?: string | null;
  embedBaseUrl?: string | null;
} = $props();

let effectiveProjectId = $derived(projectId ?? getCurrentProjectId());
let diagramEntries = $state<Dirent[]>([]);
let selectedDiagramPath = $state<string | null>(null);

function navigateToDiagram(path: string, replaceState = false) {
  const url = new URL(page.url);
  if (url.searchParams.get("diagram") === path) return;
  url.searchParams.set("diagram", path);
  void goto(`${url.pathname}${url.search}${url.hash}`, {
    replaceState,
    noScroll: true,
    keepFocus: true,
  });
}

$effect(() => {
  const id = effectiveProjectId;
  if (!id) {
    diagramEntries = [];
    selectedDiagramPath = null;
    return;
  }

  let cancelled = false;
  const fs = openProjectFs(projectStore, id);
  fs.readdir(VIEW_LAYOUT_DIR)
    .then(async (entries) => {
      const files = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith(".hcl"),
      );
      // Only layouts with at least one placed node are viewable here. A
      // `view` file carrying just a `filter` block (see the worked examples)
      // has no canvas content — filters are applied by other renderers, not
      // this viewer — so it would open as a blank diagram. It stays available
      // in the Modeling editor.
      const renderable = (
        await Promise.all(
          files.map(async (file) => ({
            file,
            layout: await readDiagramLayoutFile(
              fs,
              `${VIEW_LAYOUT_DIR}/${file.path}`,
            ),
          })),
        )
      )
        .filter(({ layout }) => Object.keys(layout.checked).length > 0)
        .map(({ file }) => file);
      if (cancelled) return;
      diagramEntries = renderable;

      const urlParam = page.url.searchParams.get("diagram");
      const matchingParam = urlParam && renderable.some((e) =>
          e.path === urlParam
        )
        ? urlParam
        : null;
      const first = renderable[0]?.path ?? null;
      selectedDiagramPath = matchingParam ?? first;
      if (!matchingParam && first) navigateToDiagram(first, true);
    })
    .catch(() => {
      if (cancelled) return;
      diagramEntries = [];
      selectedDiagramPath = null;
    });

  return () => {
    cancelled = true;
  };
});

$effect(() => {
  const urlParam = page.url.searchParams.get("diagram");
  if (urlParam && diagramEntries.some((entry) => entry.path === urlParam)) {
    selectedDiagramPath = urlParam;
  }
});
</script>

<div class="flex flex-col md:flex-row flex-1 w-full h-full overflow-hidden">
  {#if !effectiveProjectId}
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="card bg-base-200 shadow-xl">
        <div class="card-body items-center text-center">
          <h2 class="card-title">No project selected</h2>
          <p class="text-base-content/60 text-sm">
            Select or create a project from the Projects page to explore its diagrams.
          </p>
          <a href={resolve("/projects", {})} class="btn btn-primary mt-2">
            Back to projects
          </a>
        </div>
      </div>
    </div>
  {:else}
    <!--
      Diagrams selector: horizontal scrollable bar on mobile (< md), vertical
      sidebar on desktop (>= md). This sidebar is the page's only chrome — the
      embed action sits pinned at its bottom, so the canvas needs no second
      navbar of its own. Desktop overflow lives on the tree (not the aside) so
      that button stays put when the list is long.
    -->
    <aside
      aria-label="Diagrams"
      data-tour={TOUR_TARGETS.explore}
      class="w-full shrink-0 bg-base-100 text-base-content border-b border-base-300 p-2 md:w-64 md:border-b-0 md:border-r md:p-4 flex flex-col"
    >
      <!-- Mobile: horizontal scrollable diagrams selection -->
      <div class="flex md:hidden items-center gap-2 overflow-x-auto py-1 scroll-smooth">
        <span
          class="font-semibold text-xs text-base-content/70 uppercase tracking-wide shrink-0"
        >
          Diagrams:
        </span>
        {#if diagramEntries.length === 0}
          <span class="text-base-content/50 text-xs">No diagrams</span>
        {:else}
          <div class="flex flex-row gap-1.5 shrink-0 items-center">
            {#each diagramEntries as entry (entry.path)}
              <button
                type="button"
                class="btn btn-xs shrink-0 whitespace-nowrap {selectedDiagramPath === entry.path ? 'btn-primary' : 'btn-ghost'}"
                aria-current={selectedDiagramPath === entry.path
                  ? "true"
                  : undefined}
                onclick={() => navigateToDiagram(entry.path)}
              >
                {entry.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Desktop: vertical FileTree sidebar -->
      <div class="hidden md:flex flex-col flex-1 min-h-0 md:overflow-y-auto">
        <h3
          class="font-semibold text-sm mb-3 text-base-content/70 uppercase tracking-wide"
        >
          Diagrams
        </h3>
        {#if diagramEntries.length === 0}
          <p class="text-base-content/50 text-sm">
            No diagrams in this project.
          </p>
        {:else}
          <FileTree
            entries={diagramEntries}
            bind:selectedPath={() => selectedDiagramPath, (path) => {
              if (path) navigateToDiagram(path);
            }}
          />
        {/if}
      </div>

      <!--
        Embed action for the open diagram, pinned below the tree. Desktop
        only: copying an embed snippet is an authoring aid, not a phone
        task, and on mobile that strip is precious vertical space.
      -->
      {#if selectedDiagramPath}
        <div
          class="hidden md:block shrink-0 pt-3 border-t border-base-300"
        >
          <EmbedDiagramButton
            projectId={effectiveProjectId}
            diagramPath={selectedDiagramPath}
            baseUrl={embedBaseUrl}
          />
        </div>
      {/if}
    </aside>

    <!-- Canvas -->
    <div
      class="relative flex-1 min-w-0 min-h-0 w-full h-full bg-base-300 flex items-center justify-center overflow-hidden"
    >
      {#if selectedDiagramPath}
        <DiagramViewer
          projectId={effectiveProjectId}
          diagramPath={selectedDiagramPath}
          onOpenDiagram={navigateToDiagram}
        />
      {:else}
        <div class="flex h-full w-full items-center justify-center text-xs sm:text-sm text-base-content/60 p-4 text-center">
          Select a diagram to explore it.
        </div>
      {/if}
    </div>
  {/if}
</div>
