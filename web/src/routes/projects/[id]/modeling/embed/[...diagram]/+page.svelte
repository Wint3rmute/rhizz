<script lang="ts">
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { projectStore } from "../../../../../../ProjectState.svelte";
import { getWarningLevel } from "../../../../../../WarningLevelState.svelte";
import { toastState } from "../../../../../../ToastState.svelte";
import { compile_system } from "../../../../../../rhizz_wasm_wrapper";
import { readProjectSources, type Source } from "../../../../../../vfs/compile";
import { type Dirent, openProjectFs } from "../../../../../../vfs/fs";
import { componentKeyAt } from "../../../../../../modelKeys";
import DiagramEmbedView from "../../DiagramEmbedView.svelte";
import { sceneFromModel } from "../../../../../../modelView";
import {
  type DiagramLayout,
  emptyDiagramLayout,
  readDiagramLayoutFile,
  VIEW_LAYOUT_DIR,
} from "../../persistence";
import { type ProjectDoc, readProjectDocs } from "../../../explore/docs";
import { findComponentDiagram } from "../../../explore/navigation";
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
// The project-wide warning preset (navbar select); read inside the `$derived`
// compile below so the embed follows the same level as the main app.
let warningLevel = $derived(getWarningLevel());
let layout = $state<DiagramLayout>(emptyDiagramLayout());
let layoutLoaded = $state(false);
let docs = $state<ProjectDoc[]>([]);
let hoveredKey = $state<string | null>(null);
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
  readDiagramLayoutFile(fs, `${VIEW_LAYOUT_DIR}/${path}`)
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
    return compile_system(sources, warningLevel);
  } catch {
    return null;
  }
});

let model = $derived(output ? output.model() : undefined);
let systems = $derived(model ? model.systems() : []);
let components = $derived(model ? model.components() : []);
let connections = $derived(model ? model.connections() : []);

let componentKeys = $derived(model ? model.component_keys() : []);

// Every view file in the project: drill-down targets are resolved against
// these with the shared `findComponentDiagram` helper (qualified path
// first, bare label second), exactly like Explore.
let diagramEntries = $state<Dirent[]>([]);

$effect(() => {
  const currentId = projectId;
  if (!currentId) {
    diagramEntries = [];
    return;
  }
  let cancelled = false;
  const fs = openProjectFs(projectStore, currentId);
  fs.readdir(VIEW_LAYOUT_DIR, { recursive: true })
    .then((entries) => {
      if (cancelled) return;
      diagramEntries = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith(".hcl"),
      );
    })
    .catch(() => {
      if (cancelled) return;
      diagramEntries = [];
    });
  return () => {
    cancelled = true;
  };
});

let componentDiagrams = $derived.by(() => {
  const map = new SvelteMap<string, Dirent>();
  components.forEach((component, index) => {
    const key = componentKeyAt(componentKeys, index);
    const diagram = findComponentDiagram(diagramEntries, component.label, key);
    if (diagram) map.set(key, diagram);
  });
  return map;
});

let linkedComponents = $derived.by(
  () => new SvelteSet<string>(componentDiagrams.keys()),
);

// Clicking a node navigates within the embed route (back/forward friendly):
// linked nodes swap the `[...diagram]` param, unlinked ones toast — the
// same feedback Explore shows for a missing detail view.
function handleNodeClick(key: string): void {
  const diagram = componentDiagrams.get(key);
  if (diagram) {
    const base = resolve("/projects/[id]/modeling/embed/[...diagram]", {
      id: projectId ?? "",
      diagram: diagram.path,
    });
    void goto(base);
    return;
  }
  const label = scene.byKey.get(key)?.label ?? key;
  toastState.show(`No detailed view for ${label} created`, "info");
}

let scene = $derived(
  sceneFromModel(model, layout.checked, layout.annotations ?? []),
);

// Docs keyed by component label, matching how the Explore view associates a
// doc with a component (by its unique label, not its full qualified path).
let docsByLabel = $derived.by(() => {
  const map = new SvelteMap<string, string>();
  for (const doc of docs) map.set(doc.key, doc.content);
  return map;
});

// The doc content for the hovered component, if one exists.
let hoveredDoc = $derived(
  hoveredKey === null ? null : (() => {
    const label = scene.byKey.get(hoveredKey)?.label;
    return label === undefined ? undefined : docsByLabel.get(label);
  })() ?? null,
);

function handleNodeHover(key: string | null, event?: MouseEvent) {
  hoveredKey = key;
  if (key === null || !event || !canvasContainer) {
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
  {:else if scene.nodes.length === 0 && scene.annotations.length === 0}
    <div class="flex-1 flex items-center justify-center text-sm text-base-content/60 p-4 text-center">
      Diagram "{normalizedDiagramPath}" has no placed components or annotations.
    </div>
  {:else}
    <div
      bind:this={canvasContainer}
      class="relative flex-1 w-full h-full overflow-hidden"
    >
      <DiagramEmbedView
        scene={scene}
        projectId={projectId}
        diagramPath={normalizedDiagramPath}
        linked={linkedComponents}
        onnodeclick={handleNodeClick}
        onnodehover={handleNodeHover}
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
