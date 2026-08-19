<script lang="ts">
import type { ComponentJS, SystemJS } from "rhizz";
import { SvelteMap } from "svelte/reactivity";
import { resolve } from "$app/paths";
import {
  getCurrentProjectId,
  projectStore,
} from "../../../../ProjectState.svelte";
import { compile_system } from "../../../../rhizz_wasm_wrapper";
import { readProjectSources, type Source } from "../../../../vfs/compile";
import { type Dirent, openProjectFs } from "../../../../vfs/fs";
import FileTree from "../editor/FileTree.svelte";
import DiagramStaticView, {
  type DiagramStaticBox,
} from "../diagrams/DiagramStaticView.svelte";
import {
  DIAGRAM_LAYOUT_DIR,
  type DiagramLayout,
  emptyDiagramLayout,
  readDiagramLayoutFile,
} from "../diagrams/persistence";

let {
  projectId = null,
}: {
  projectId?: string | null;
} = $props();

let effectiveProjectId = $derived(projectId ?? getCurrentProjectId());
let diagramEntries = $state<Dirent[]>([]);
let selectedDiagramPath = $state<string | null>(null);
let selectedLayout = $state<DiagramLayout>(emptyDiagramLayout());
let sources = $state<Source[]>([]);

function getInitialDiagramParam(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("diagram");
  } catch {
    return null;
  }
}

function syncUrlDiagram(path: string | null) {
  if (typeof window === "undefined" || !path) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("diagram") !== path) {
      url.searchParams.set("diagram", path);
      window.history.replaceState({}, "", url.toString());
    }
  } catch {
    // Ignore in sandboxed / non-standard environments
  }
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
  fs.readdir(DIAGRAM_LAYOUT_DIR)
    .then((entries) => {
      if (cancelled) return;
      const files = entries.filter((entry) =>
        entry.isFile() && entry.name.endsWith(".json")
      );
      diagramEntries = files;

      const urlParam = getInitialDiagramParam();
      const matchingParam = urlParam && files.some((e) => e.path === urlParam)
        ? urlParam
        : null;

      if (matchingParam) {
        selectedDiagramPath = matchingParam;
      } else if (
        selectedDiagramPath === null ||
        !files.some((entry) => entry.path === selectedDiagramPath)
      ) {
        const first = files[0]?.path ?? null;
        selectedDiagramPath = first;
        syncUrlDiagram(first);
      }
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
  syncUrlDiagram(selectedDiagramPath);
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
  readDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${path}`)
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

function componentKey(index: number): string {
  const allComponents: ComponentJS[] = components;
  const allSystems: SystemJS[] = systems;
  const parts: string[] = [];
  let current: number | undefined = index;

  while (current !== undefined) {
    const component: ComponentJS | undefined = allComponents[current];
    if (!component) return `#${index}`;
    parts.unshift(component.label);
    if (component.parent_component_index !== undefined) {
      current = component.parent_component_index;
      continue;
    }
    const system = component.parent_system_index !== undefined
      ? allSystems[component.parent_system_index]
      : undefined;
    if (system) parts.unshift(system.label);
    current = undefined;
  }

  return parts.join("/");
}

let keyToIndex = $derived.by(() => {
  const map = new SvelteMap<string, number>();
  components.forEach((_: unknown, index: number) => {
    map.set(componentKey(index), index);
  });
  return map;
});

let boxes = $derived.by<Record<number, DiagramStaticBox>>(() => {
  const next: Record<number, DiagramStaticBox> = {};
  for (const [key, box] of Object.entries(selectedLayout.checked)) {
    const index = keyToIndex.get(key);
    if (index === undefined) continue;
    next[index] = {
      x: box.x,
      y: box.y,
      width: box.width ?? 100,
      height: box.height ?? 100,
      textAlign: box.textAlign ?? "center",
    };
  }
  return next;
});
</script>

<div class="flex flex-col md:flex-row flex-1 w-full h-full overflow-hidden">
  {#if !effectiveProjectId}
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="card bg-base-200 shadow-xl">
        <div class="card-body items-center text-center">
          <h2 class="card-title">No project selected</h2>
          <p class="text-base-content/60 text-sm">
            Select or create a project from the Projects page to browse its diagrams.
          </p>
          <a href={resolve("/projects", {})} class="btn btn-primary mt-2">
            Back to projects
          </a>
        </div>
      </div>
    </div>
  {:else}
    <!-- Diagrams selector: horizontal scrollable bar on mobile (< md), vertical sidebar on desktop (>= md) -->
    <aside
      class="w-full shrink-0 bg-base-100 text-base-content border-b border-base-300 p-2 md:w-64 md:border-b-0 md:border-r md:p-4 md:overflow-y-auto flex flex-col"
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
                onclick={() => (selectedDiagramPath = entry.path)}
              >
                {entry.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Desktop: vertical FileTree sidebar -->
      <div class="hidden md:flex flex-col flex-1">
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
            bind:selectedPath={selectedDiagramPath}
          />
        {/if}
      </div>
    </aside>

    <!-- Main canvas: full-width on mobile (< md), flex-1 on desktop (>= md) -->
    <div class="flex flex-col flex-1 min-w-0 min-h-0 h-full">
      <div class="relative flex-1 w-full h-full bg-base-300 flex items-center justify-center overflow-hidden">
        {#if selectedDiagramPath}
          <div class="w-full h-full">
            <DiagramStaticView
              components={components}
              connections={connections}
              boxes={boxes}
            />
          </div>
        {:else}
          <div class="flex h-full w-full items-center justify-center text-xs sm:text-sm text-base-content/60 p-4 text-center">
            Select a diagram to view it.
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
