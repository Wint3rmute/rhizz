<script lang="ts">
import type { ComponentJS, SystemJS } from "rhizz";
import { SvelteMap } from "svelte/reactivity";
import { projectStore } from "../../../../../../ProjectState.svelte";
import { compile_system } from "../../../../../../rhizz_wasm_wrapper";
import { readProjectSources, type Source } from "../../../../../../vfs/compile";
import { openProjectFs } from "../../../../../../vfs/fs";
import DiagramEmbedView from "../../DiagramEmbedView.svelte";
import type { DiagramStaticBox } from "../../DiagramStaticView.svelte";
import {
  DIAGRAM_LAYOUT_DIR,
  type DiagramLayout,
  emptyDiagramLayout,
  readDiagramLayoutFile,
} from "../../persistence";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();

let projectId = $derived(data.projectId);
let rawDiagramParam = $derived(data.diagramParam);

// Normalize diagram filename (e.g. "overview" -> "overview.hcl")
let normalizedDiagramPath = $derived.by(() => {
  if (!rawDiagramParam) return "main.hcl";
  return rawDiagramParam.endsWith(".hcl") || rawDiagramParam.endsWith(".json")
    ? rawDiagramParam
    : `${rawDiagramParam}.hcl`;
});

let sources = $state<Source[]>([]);
let layout = $state<DiagramLayout>(emptyDiagramLayout());
let layoutLoaded = $state(false);

$effect(() => {
  const currentId = projectId;
  if (!currentId) return;

  const fs = openProjectFs(projectStore, currentId);
  readProjectSources(fs)
    .then((s: Source[]) => {
      sources = s;
    })
    .catch(() => {
      sources = [];
    });
});

$effect(() => {
  const currentId = projectId;
  const path = normalizedDiagramPath;
  if (!currentId || !path) return;

  const fs = openProjectFs(projectStore, currentId);
  readDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${path}`)
    .then((loadedLayout) => {
      layout = loadedLayout;
      layoutLoaded = true;
    })
    .catch(() => {
      layout = emptyDiagramLayout();
      layoutLoaded = true;
    });
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
  for (const [key, box] of Object.entries(layout.checked)) {
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

<!-- Chromeless standalone embed takeover container -->
<div
  class="fixed inset-0 z-40 w-screen h-screen bg-base-300 flex flex-col overflow-hidden">
  {#if !layoutLoaded}
    <div class="flex-1 flex items-center justify-center text-sm text-base-content/60">
      Loading diagram…
    </div>
  {:else if Object.keys(boxes).length === 0}
    <div class="flex-1 flex items-center justify-center text-sm text-base-content/60 p-4 text-center">
      Diagram "{normalizedDiagramPath}" has no placed components.
    </div>
  {:else}
    <DiagramEmbedView
      components={components}
      connections={connections}
      boxes={boxes}
      projectId={projectId}
      diagramPath={normalizedDiagramPath}
    />
  {/if}
</div>
