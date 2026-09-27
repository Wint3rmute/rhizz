<script lang="ts">
import type { ComponentJS, SystemJS } from "rhizz";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { page } from "$app/state";
import {
  getCurrentProjectId,
  projectStore,
} from "../../../../ProjectState.svelte";
import { compile_system } from "../../../../rhizz_wasm_wrapper";
import { toastState } from "../../../../ToastState.svelte";
import { readProjectSources, type Source } from "../../../../vfs/compile";
import { type Dirent, openProjectFs } from "../../../../vfs/fs";
import FileTree from "../code/FileTree.svelte";
import DiagramStaticView from "../modeling/DiagramStaticView.svelte";
import EmbedDiagramButton from "../modeling/EmbedDiagramButton.svelte";
import {
  type DiagramLayout,
  emptyDiagramLayout,
  readDiagramLayoutFile,
  VIEW_LAYOUT_DIR,
} from "../modeling/persistence";
import { componentDataByKey, sceneFromModel } from "../../../../modelView";
import Markdown from "../../../../components/Markdown.svelte";
import { type ProjectDoc, readProjectDocs, withFullNameHeader } from "./docs";
import { componentKeyAt } from "../../../../modelKeys";
import { TOUR_TARGETS } from "../../../../tour/tourTargets";
import { findComponentDiagram } from "./navigation";

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
let selectedLayout = $state<DiagramLayout>(emptyDiagramLayout());
let sources = $state<Source[]>([]);
let docs = $state<ProjectDoc[]>([]);

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

$effect(() => {
  const id = effectiveProjectId;
  const path = selectedDiagramPath;

  if (!id || !path) {
    selectedLayout = emptyDiagramLayout();
    return;
  }

  let cancelled = false;
  const fs = openProjectFs(projectStore, id);
  readDiagramLayoutFile(fs, `${VIEW_LAYOUT_DIR}/${path}`)
    .then((layout) => {
      if (cancelled) return;
      selectedLayout = layout;
    })
    .catch(() => {
      if (cancelled) return;
      selectedLayout = emptyDiagramLayout();
    });

  return () => {
    cancelled = true;
  };
});

$effect(() => {
  const id = effectiveProjectId;
  if (!id) {
    sources = [];
    docs = [];
    return;
  }

  let cancelled = false;
  const fs = openProjectFs(projectStore, id);
  readProjectSources(fs)
    .then((loadedSources) => {
      if (cancelled) return;
      sources = loadedSources;
    })
    .catch(() => {
      if (cancelled) return;
      sources = [];
    });
  readProjectDocs(fs)
    .then((loadedDocs) => {
      if (cancelled) return;
      docs = loadedDocs;
    })
    .catch(() => {
      if (cancelled) return;
      docs = [];
    });

  return () => {
    cancelled = true;
  };
});

let output = $derived.by(() => {
  if (sources.length === 0) return null;
  try {
    return compile_system(sources);
  } catch {
    return null;
  }
});
let model = $derived(output ? output.model() : undefined);
let systems = $derived(model ? model.systems() : []);
let components = $derived(model ? model.components() : []);
let connections = $derived(model ? model.connections() : []);

// Structurally-stable component keys, computed by rhizz-core
// (`Model::component_keys`) and index-aligned with `components`.
let componentKeys = $derived(model ? model.component_keys() : []);

// The rendered diagram. Everything below addresses components by this key
// rather than by arena index, so a rename or an edit earlier in the source
// cannot silently reattach a node's detail view to a different component.
let diagramScene = $derived(
  sceneFromModel(
    model,
    selectedLayout.checked,
    selectedLayout.annotations ?? [],
  ),
);

let componentData = $derived(componentDataByKey(model));

let componentDiagrams = $derived.by(() => {
  const map = new SvelteMap<string, Dirent>();
  components.forEach((component: ComponentJS, index: number) => {
    const key = componentKeyAt(componentKeys, index);
    const diagram = findComponentDiagram(diagramEntries, component.label, key);
    if (diagram) map.set(key, diagram);
  });
  return map;
});

let linkedComponents = $derived.by(
  () => new SvelteSet<string>(componentDiagrams.keys()),
);

// Docs keyed by component label. A component is matched by its unique name
// (its `label`), not its full qualified path — a component may be re-used
// under different parents, so the path is not a stable identifier.
let docsByLabel = $derived.by(() => {
  const map = new SvelteMap<string, string>();
  for (const doc of docs) map.set(doc.key, doc.content);
  return map;
});

// The component index currently hovered (if any) and the cursor position at
// which the popup should be anchored.
let hoveredKey = $state<string | null>(null);
let hoverPos = $state<{ x: number; y: number } | null>(null);

// The container the popup is positioned against (the `relative` canvas
// wrapper). Viewport cursor coordinates are converted to container-relative
// ones so the popup sits right next to the cursor.
let canvasContainer: HTMLDivElement | undefined = $state();

// The hovered node's *cursor* position, kept in viewport coordinates. The
// container-relative anchor is derived from it (see handleNodeHover) and
// re-derived on scroll, because a popup positioned once from a rect measured
// mid-scroll detaches from the cursor and stays detached — the container can
// scroll under a stationary cursor (small screens, keyboard scrolling), and
// a stale offset is also what makes a screenshot of an open popup
// unreproducible.
let hoverClient = $state<{ x: number; y: number } | null>(null);

function positionPopup(): void {
  if (hoveredKey === null || hoverClient === null || !canvasContainer) {
    hoverPos = null;
    return;
  }
  const rect = canvasContainer.getBoundingClientRect();
  hoverPos = {
    x: hoverClient.x - rect.left,
    y: hoverClient.y - rect.top,
  };
}

function handleNodeHover(key: string | null, event?: MouseEvent) {
  hoveredKey = key;
  if (key === null || !event) {
    hoverClient = null;
    positionPopup();
    return;
  }
  hoverClient = { x: event.clientX, y: event.clientY };
  positionPopup();
}

// Any scroll in the subtree (the diagram canvas, a sidebar) moves the
// container under a stationary cursor, so re-anchor the popup to it. Capture
// phase, because `scroll` does not bubble: a document-level capture listener
// sees a scroll of anything below it, a window-level one would not.
$effect(() => {
  const onScroll = () => positionPopup();
  document.addEventListener("scroll", onScroll, true);
  return () => document.removeEventListener("scroll", onScroll, true);
});

// The doc content for the hovered component, if one exists. Matched by the
// component's unique label rather than its full qualified path. When the
// component declares a `full_name`, it heads the tooltip as an L1 header.
let hoveredDoc = $derived.by(() => {
  if (hoveredKey === null) return null;
  const component = componentData.get(hoveredKey);
  if (component === undefined) return null;
  const doc = docsByLabel.get(component.label) ?? null;
  if (doc === null) return null;
  return withFullNameHeader(doc, component.full_name ?? "");
});

function handleNodeClick(key: string) {
  const component = componentData.get(key);
  if (component === undefined) return;
  const diagram = componentDiagrams.get(key);
  if (diagram) {
    navigateToDiagram(diagram.path);
    return;
  }
  toastState.show(`No detailed view for ${component.label} created`, "info");
}
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
      bind:this={canvasContainer}
      class="relative flex-1 min-w-0 min-h-0 w-full h-full bg-base-300 flex items-center justify-center overflow-hidden"
    >
      {#if selectedDiagramPath}
        <div class="w-full h-full">
          <DiagramStaticView
            scene={diagramScene}
            linked={linkedComponents}
            onnodeclick={handleNodeClick}
            onnodehover={handleNodeHover}
          />
          {#if hoveredDoc && hoverPos}
            <div
              class="absolute z-30 max-w-sm pointer-events-none"
              style="left: {hoverPos.x + 12}px; top: {hoverPos.y + 12}px;"
            >
              <div
                class="card bg-base-100 border border-base-content/40 shadow-xl p-3"
                data-testid="explore-doc-tooltip"
              >
                <Markdown content={hoveredDoc} />
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex h-full w-full items-center justify-center text-xs sm:text-sm text-base-content/60 p-4 text-center">
          Select a diagram to explore it.
        </div>
      {/if}
    </div>
  {/if}
</div>
