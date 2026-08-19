<script lang="ts">
import type { ComponentJS, SystemJS } from "rhizz";
import { SvelteMap } from "svelte/reactivity";
import { resolve } from "$app/paths";
import { page } from "$app/state";
import { replaceState } from "$app/navigation";
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

      const urlParam = page.url.searchParams.get("diagram");
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
        if (first && typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("diagram", first);
          replaceState(url.toString(), {});
        }
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
  const path = selectedDiagramPath;
  if (path && typeof window !== "undefined") {
    const url = new URL(window.location.href);
    if (url.searchParams.get("diagram") !== path) {
      url.searchParams.set("diagram", path);
      replaceState(url.toString(), {});
    }
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

let output = $derived.by(() => compile_system(sources));
let model = $derived(output.model());
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

<div class="flex flex-row flex-1 w-full h-full overflow-hidden">
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
    <!-- Left sidebar: Flat diagrams list matching diagrams editor style -->
    <aside
      class="w-64 shrink-0 bg-base-100 text-base-content p-4 overflow-y-auto border-r border-base-300 flex flex-col"
    >
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
    </aside>

    <!-- Main canvas: Flat, edge-to-edge canvas matching diagrams editor style without grid/nested frames -->
    <div class="flex flex-col flex-1 min-w-0 h-full">
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
          <div class="flex h-full w-full items-center justify-center text-base-content/60">
            Select a diagram from the sidebar to view it.
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
