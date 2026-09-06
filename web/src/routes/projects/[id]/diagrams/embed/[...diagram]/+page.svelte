<script lang="ts">
import { SvelteMap } from "svelte/reactivity";
import { projectStore } from "../../../../../../ProjectState.svelte";
import { compile_system } from "../../../../../../rhizz_wasm_wrapper";
import { readProjectSources, type Source } from "../../../../../../vfs/compile";
import { openProjectFs } from "../../../../../../vfs/fs";
import DiagramEmbedView from "../../DiagramEmbedView.svelte";
import type { DiagramStaticBox } from "../../types";
import {
  buildKeyToIndexMap,
  DIAGRAM_LAYOUT_DIR,
  type DiagramLayout,
  emptyDiagramLayout,
  mapLayoutToBoxes,
  readDiagramLayoutFile,
} from "../../persistence";
import { type ProjectDoc, readProjectDocs } from "../../../explore/docs";
import Markdown from "../../../../../../components/Markdown.svelte";
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
let docs = $state<ProjectDoc[]>([]);
let hoveredIndex = $state<number | null>(null);
let hoverPos = $state<{ x: number; y: number } | null>(null);
let canvasContainer: HTMLDivElement | undefined = $state();

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
  readProjectDocs(fs)
    .then((loadedDocs) => {
      docs = loadedDocs;
    })
    .catch(() => {
      docs = [];
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

// Docs keyed by component label, matching how the Explore view associates a
// doc with a component (by its unique label, not its full qualified path).
let docsByLabel = $derived.by(() => {
  const map = new SvelteMap<string, string>();
  for (const doc of docs) map.set(doc.key, doc.content);
  return map;
});

// The doc content for the hovered component, if one exists.
let hoveredDoc = $derived(
  hoveredIndex === null ? null : (() => {
    const component = components[hoveredIndex];
    const label = component?.label;
    return label === undefined ? undefined : docsByLabel.get(label);
  })() ?? null,
);

function handleNodeHover(index: number | null, event?: MouseEvent) {
  hoveredIndex = index;
  if (index === null || !event || !canvasContainer) {
    hoverPos = null;
    return;
  }
  const rect = canvasContainer.getBoundingClientRect();
  hoverPos = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}
</script>

<!-- Chromeless standalone embed takeover container -->
<div
  class="fixed inset-0 z-40 w-screen h-screen bg-base-300 flex flex-col overflow-hidden">
  {#if !layoutLoaded}
    <div class="flex-1 flex items-center justify-center text-sm text-base-content/60">
      Loading diagram…
    </div>
  {:else if Object.keys(boxes).length === 0 && (layout.annotations ?? []).length === 0}
    <div class="flex-1 flex items-center justify-center text-sm text-base-content/60 p-4 text-center">
      Diagram "{normalizedDiagramPath}" has no placed components or annotations.
    </div>
  {:else}
    <div
      bind:this={canvasContainer}
      class="relative flex-1 w-full h-full overflow-hidden"
    >
      <DiagramEmbedView
        components={components}
        connections={connections}
        boxes={boxes}
        annotations={layout.annotations ?? []}
        projectId={projectId}
        diagramPath={normalizedDiagramPath}
        onnodehover={(index, event) => handleNodeHover(index, event)}
      />
      {#if hoveredDoc && hoverPos}
        <div
          class="absolute z-30 max-w-sm pointer-events-none"
          style="left: {hoverPos.x + 12}px; top: {hoverPos.y + 12}px;"
        >
          <div class="card bg-base-100 border border-base-content/40 shadow-xl p-3">
            <Markdown content={hoveredDoc} />
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
