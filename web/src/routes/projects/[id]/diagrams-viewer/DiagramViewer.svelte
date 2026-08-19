<script lang="ts">
  import type { ComponentJS, SystemJS } from "rhizz";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import { getCurrentProjectId, projectStore } from "../../../../ProjectState.svelte";
  import { compile_system } from "../../../../rhizz_wasm_wrapper";
  import { readProjectSources, type Source } from "../../../../vfs/compile";
  import { type Dirent, openProjectFs } from "../../../../vfs/fs";
  import { buildPathTree, type PathTreeNode } from "../../../../vfs/pathTree";
  import DiagramStaticView, {
    type DiagramStaticBox,
  } from "../diagrams/DiagramStaticView.svelte";
  import {
    DIAGRAM_LAYOUT_DIR,
    emptyDiagramLayout,
    readDiagramLayoutFile,
    type DiagramLayout,
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

  const collapsedPaths = new SvelteSet<string>();

  function toggleCollapsed(path: string) {
    if (collapsedPaths.has(path)) collapsedPaths.delete(path);
    else collapsedPaths.add(path);
  }

  function selectDiagram(path: string) {
    selectedDiagramPath = path;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("diagram", path);
      replaceState(url.toString(), {});
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

  let tree = $derived(buildPathTree(diagramEntries));

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

{#snippet renderTree(node: PathTreeNode, depth: number)}
  {#if node.isDirectory}
    {@const isCollapsed = collapsedPaths.has(node.path)}
    <li>
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-base-300"
        style="padding-left: {depth * 12}px"
        aria-expanded={!isCollapsed}
        onclick={() => toggleCollapsed(node.path)}
      >
        <span class="w-4 text-xs text-base-content/60" aria-hidden="true">
          {isCollapsed ? "▸" : "▾"}
        </span>
        <span>{node.name}</span>
      </button>
      {#if !isCollapsed}
        <ul>
          {#each node.children as child (child.path)}
            {@render renderTree(child, depth + 1)}
          {/each}
        </ul>
      {/if}
    </li>
  {:else if node.name.endsWith(".json")}
    <li>
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-base-300"
        style="padding-left: {depth * 12}px"
        onclick={() => selectDiagram(node.path)}
      >
        <span class="text-base-content/60" aria-hidden="true">📄</span>
        <span
          class={selectedDiagramPath === node.path ? "font-semibold text-primary" : ""}
        >
          {node.name}
        </span>
      </button>
    </li>
  {/if}
{/snippet}

<div class="flex-1 w-full overflow-y-auto bg-base-100 text-base-content">
  <div class="w-full px-2 py-2 sm:px-4 sm:py-4">
    {#if !effectiveProjectId}
      <div class="card bg-base-200 shadow-sm">
        <div class="card-body items-center text-center gap-3 py-10">
          <div class="text-4xl">🗂️</div>
          <h2 class="card-title">No project selected</h2>
          <p class="text-base-content/60 text-sm">
            Select or create a project from the Projects page to browse its diagrams.
          </p>
          <a href={resolve("/projects", {})} class="btn btn-primary btn-sm">
            Open Projects
          </a>
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#if tree.length === 0}
          <div class="card bg-base-200 shadow-sm">
            <div class="card-body items-center text-center py-10">
              <div class="text-4xl">📐</div>
              <h2 class="card-title">No diagrams in this project</h2>
              <p class="text-base-content/60 text-sm">
                Add a diagram layout under .rhizz/diagrams to use the viewer.
              </p>
            </div>
          </div>
        {:else}
          <div class="card bg-base-200 shadow-sm">
            <div class="card-body gap-3 p-3 sm:p-4">
              <h3 class="text-sm font-semibold uppercase tracking-wide text-base-content/60">
                Diagram files
              </h3>
              <ul class="max-h-64 overflow-y-auto">
                {#each tree as node (node.path)}
                  {@render renderTree(node, 0)}
                {/each}
              </ul>
            </div>
          </div>

          <div class="card bg-base-200 shadow-sm">
            <div class="card-body gap-3 p-2 sm:p-3">
              {#if selectedDiagramPath}
                <div class="overflow-hidden rounded-lg border border-base-300 bg-base-100">
                  <div class="h-[60vh] min-h-[320px] w-full">
                    <DiagramStaticView
                      components={components}
                      connections={connections}
                      boxes={boxes}
                    />
                  </div>
                </div>
              {:else}
                <div class="flex min-h-[280px] items-center justify-center text-base-content/60">
                  Select a diagram from the tree above.
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
