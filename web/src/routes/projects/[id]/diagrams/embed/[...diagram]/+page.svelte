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
  buildKeyToIndexMap,
  DIAGRAM_LAYOUT_DIR,
  type DiagramLayout,
  emptyDiagramLayout,
  mapLayoutToBoxes,
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

let keyToIndex = $derived.by(() => {
  return buildKeyToIndexMap(components, systems);
});

let boxes = $derived.by<Record<number, DiagramStaticBox>>(() => {
  return mapLayoutToBoxes(layout.checked, keyToIndex);
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
