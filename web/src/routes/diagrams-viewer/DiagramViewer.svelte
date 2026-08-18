<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { resolve } from "$app/paths";
  import { getCurrentProjectId, projectStore } from "../../ProjectState.svelte";
  import { compile_system } from "../../rhizz_wasm_wrapper";
  import { readProjectSources, type Source } from "../../vfs/compile";
  import { type Dirent, openProjectFs } from "../../vfs/fs";
  import { buildPathTree, type PathTreeNode } from "../../vfs/pathTree";
  import type { Project } from "../../vfs/types";
  import DiagramStaticView, {
    type DiagramStaticBox,
  } from "../projects/[id]/diagrams/DiagramStaticView.svelte";
  import {
    DIAGRAM_LAYOUT_DIR,
    readDiagramLayoutFile,
    type DiagramLayout,
  } from "../projects/[id]/diagrams/persistence";

  let {
    projectId = null,
  }: {
    projectId?: string | null;
  } = $props();

  let projects = $state<Project[]>([]);
  let selectedProjectId = $state<string | null>(getCurrentProjectId());
  let diagramEntries = $state<Dirent[]>([]);
  let selectedDiagramPath = $state<string | null>(null);
  let selectedLayout = $state<DiagramLayout>({ checked: {}, savedLayout: {} });
  let sources = $state<Source[]>([]);

  $effect(() => {
    if (projectId !== null && projectId !== undefined) {
      selectedProjectId = projectId;
    }
  });

  const collapsedPaths = new SvelteSet<string>();

  function toggleCollapsed(path: string) {
    if (collapsedPaths.has(path)) collapsedPaths.delete(path);
    else collapsedPaths.add(path);
  }

  $effect(() => {
    projectStore.listProjects().then((projectList) => {
      const sorted = projectList.toSorted((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      );
      projects = sorted;

      if (projectId !== null && projectId !== undefined) {
        selectedProjectId = projectId;
        return;
      }

      if (
        selectedProjectId === null ||
        !sorted.some((project) => project.id === selectedProjectId)
      ) {
        selectedProjectId = sorted[0]?.id ?? null;
      }
    });
  });

  $effect(() => {
    if (!selectedProjectId) {
      diagramEntries = [];
      selectedDiagramPath = null;
      return;
    }

    const fs = openProjectFs(projectStore, selectedProjectId);
    fs.readdir(DIAGRAM_LAYOUT_DIR)
      .then((entries) => {
        const files = entries.filter((entry) =>
          entry.isFile() && entry.name.endsWith(".json")
        );
        diagramEntries = files;
        if (
          selectedDiagramPath === null ||
          !files.some((entry) => entry.path === selectedDiagramPath)
        ) {
          selectedDiagramPath = files[0]?.path ?? null;
        }
      })
      .catch(() => {
        diagramEntries = [];
        selectedDiagramPath = null;
      });
  });

  $effect(() => {
    if (!selectedProjectId || !selectedDiagramPath) {
      selectedLayout = { checked: {}, savedLayout: {} };
      return;
    }

    const fs = openProjectFs(projectStore, selectedProjectId);
    readDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${selectedDiagramPath}`)
      .then((layout) => {
        selectedLayout = layout;
      })
      .catch(() => {
        selectedLayout = { checked: {}, savedLayout: {} };
      });
  });

  $effect(() => {
    if (!selectedProjectId) {
      sources = [];
      return;
    }

    const fs = openProjectFs(projectStore, selectedProjectId);
    readProjectSources(fs)
      .then((loadedSources) => {
        sources = loadedSources;
      })
      .catch(() => {
        sources = [];
      });
  });

  let output = $derived.by(() => compile_system(sources));
  let model = $derived(output.model());
  let systems = $derived(model ? model.systems() : []);
  let components = $derived(model ? model.components() : []);
  let connections = $derived(model ? model.connections() : []);

  function componentKey(index: number): string {
    const allComponents = components;
    const allSystems = systems;
    const parts: string[] = [];
    let current: number | undefined = index;

    while (current !== undefined) {
      const component = allComponents[current];
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
    const map = new Map<string, number>();
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
      const storedBox = box as {
        x: number;
        y: number;
        width?: number;
        height?: number;
        textAlign?: "center" | "top-center" | "top-left";
      };
      next[index] = {
        x: storedBox.x,
        y: storedBox.y,
        width: storedBox.width ?? 100,
        height: storedBox.height ?? 100,
        textAlign: storedBox.textAlign ?? "center",
      };
    }
    return next;
  });
</script>

{#snippet renderTree(node: PathTreeNode, depth: number)}
  {#if node.isDirectory}
    <li>
      <button
        class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-base-300"
        style="padding-left: {depth * 12}px"
        onclick={() => toggleCollapsed(node.path)}
      >
        <span class="w-4 text-xs text-base-content/60">
          {collapsedPaths.has(node.path) ? "▸" : "▾"}
        </span>
        <span>{node.name}</span>
      </button>
      {#if !collapsedPaths.has(node.path)}
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
        class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-base-300"
        style="padding-left: {depth * 12}px"
        onclick={() => (selectedDiagramPath = node.path)}
      >
        <span class="text-base-content/60">📄</span>
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
    {#if projects.length === 0}
      <div class="card bg-base-200 shadow-sm">
        <div class="card-body items-center text-center gap-3 py-10">
          <div class="text-4xl">🗂️</div>
          <h2 class="card-title">No projects yet</h2>
          <p class="text-base-content/60 text-sm">
            Create a project from the example system or from the Projects page to
            browse its diagrams.
          </p>
          <a href={resolve("/projects", {})} class="btn btn-primary btn-sm">
            Open Projects
          </a>
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        <div class="card bg-base-200 shadow-sm">
          <div class="card-body gap-3 p-3 sm:p-4">
            <label class="flex flex-col gap-1 text-sm">
              <span class="text-base-content/70">Project</span>
              <select
                class="select select-bordered select-sm w-full"
                bind:value={selectedProjectId}
              >
                {#each projects as project (project.id)}
                  <option value={project.id}>{project.name}</option>
                {/each}
              </select>
            </label>
          </div>
        </div>

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
