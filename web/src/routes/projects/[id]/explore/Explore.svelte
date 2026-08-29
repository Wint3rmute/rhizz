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
import FileTree from "../editor/FileTree.svelte";
import DiagramStaticView from "../diagrams/DiagramStaticView.svelte";
import type { DiagramStaticBox } from "../diagrams/types";
import {
  DIAGRAM_LAYOUT_DIR,
  type DiagramLayout,
  emptyDiagramLayout,
  readDiagramLayoutFile,
} from "../diagrams/persistence";
import Markdown from "../../../../components/Markdown.svelte";
import { type ProjectDoc, readProjectDocs } from "./docs";
import { diagramTitle, findComponentDiagram } from "./navigation";

// Builds a recursive hierarchical tree from a recursive `readdir` listing, for
// debug-logging the project's filesystem structure.
function buildFsTree(entries: Dirent[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) continue;
      const isLast = i === parts.length - 1;
      if (isLast) {
        node[part] = entry.isDirectory() ? {} : "<file>";
      } else {
        node[part] ??= {};
        node = node[part] as Record<string, unknown>;
      }
    }
  }
  return root;
}

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
  fs.readdir(DIAGRAM_LAYOUT_DIR)
    .then((entries) => {
      if (cancelled) return;
      const files = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith(".hcl"),
      );
      diagramEntries = files;

      const urlParam = page.url.searchParams.get("diagram");
      const matchingParam = urlParam && files.some((e) => e.path === urlParam)
        ? urlParam
        : null;
      const first = files[0]?.path ?? null;
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
  // Debug: dump the project's filesystem as a recursive hierarchical tree so
  // the docs directory layout (and how it maps to component labels) is visible.
  fs.readdir(".", { recursive: true })
    .then((entries) => {
      if (cancelled) return;
      const tree = buildFsTree(entries);
      console.log("[fs] project filesystem", JSON.stringify(tree, null, 2));
    })
    .catch((error) => {
      if (cancelled) return;
      console.log("[fs] failed to list filesystem", error);
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

let componentDiagrams = $derived.by(() => {
  const map = new SvelteMap<number, Dirent>();
  components.forEach((component: ComponentJS, index: number) => {
    const diagram = findComponentDiagram(
      diagramEntries,
      component.label,
      componentKey(index),
    );
    if (diagram) map.set(index, diagram);
  });
  return map;
});

let linkedComponents = $derived.by(() =>
  new SvelteSet<number>(componentDiagrams.keys())
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
let hoveredIndex = $state<number | null>(null);
let hoverPos = $state<{ x: number; y: number } | null>(null);

function handleNodeHover(index: number | null, event?: MouseEvent) {
  console.log("[hover] on-hover listener triggered", { index, event: !!event });
  hoveredIndex = index;
  hoverPos = index !== null && event
    ? { x: event.clientX, y: event.clientY }
    : null;
}

// The doc content for the hovered component, if one exists. Matched by the
// component's unique label rather than its full qualified path.
let hoveredDoc = $derived(
  hoveredIndex === null ? null : (() => {
    const component = components[hoveredIndex];
    const label = component?.label;
    const found = label === undefined ? undefined : docsByLabel.get(label);
    console.log("[hover] markdown search", {
      label,
      docsLoaded: docs.length,
      found: found !== undefined,
    });
    return found ?? null;
  })(),
);

function handleNodeClick(index: number) {
  const component: ComponentJS | undefined = components[index];
  if (!component) return;
  const diagram = componentDiagrams.get(index);
  if (diagram) {
    navigateToDiagram(diagram.path);
    return;
  }
  toastState.show(`No detailed view for ${component.label} created`, "info");
}

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
            Select or create a project from the Projects page to explore its diagrams.
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
                onclick={() => navigateToDiagram(entry.path)}
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
            bind:selectedPath={() => selectedDiagramPath, (path) => {
              if (path) navigateToDiagram(path);
            }}
          />
        {/if}
      </div>
    </aside>

    <!-- Main canvas: full-width on mobile (< md), flex-1 on desktop (>= md) -->
    <div class="flex flex-col flex-1 min-w-0 min-h-0 h-full">
      {#if selectedDiagramPath}
        <nav
          class="breadcrumbs px-4 py-2 text-sm border-b border-base-300 bg-base-100"
          aria-label="Diagram breadcrumb"
        >
          <ul>
            <li><span class="text-base-content/60">Explore</span></li>
            <li><span>{diagramTitle(selectedDiagramPath)}</span></li>
          </ul>
        </nav>
      {/if}
      <div class="relative flex-1 w-full h-full bg-base-300 flex items-center justify-center overflow-hidden">
        {#if selectedDiagramPath}
          <div class="w-full h-full">
            <DiagramStaticView
              components={components}
              connections={connections}
              boxes={boxes}
              linked={linkedComponents}
              onnodeclick={handleNodeClick}
              onnodehover={(index, event) => handleNodeHover(index, event)}
            />
            {#if hoveredDoc && hoverPos}
              <div
                class="absolute z-30 max-w-sm pointer-events-none"
                style="left: {hoverPos.x}px; top: {hoverPos.y}px; transform: translate(12px, 12px);"
              >
                <div class="card bg-base-100 border border-base-300 shadow-xl p-3">
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
    </div>
  {/if}
</div>
