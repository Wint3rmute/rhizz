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
import { type ProjectDoc, readProjectDocs } from "../../../../../../docs/docs";
import {
  anchorAt,
  detailViewFor,
  docFor,
  linkedKeys as linkedKeysOf,
  trackPopupAnchor,
} from "../../../../../../docs/useDiagramDrilldown.svelte";
import DocPopup from "../../../../../../docs/DocPopup.svelte";
import {
  type DiagramLayout,
  emptyDiagramLayout,
  readDiagramLayoutFile,
  VIEW_LAYOUT_DIR,
} from "../../persistence";
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

let scene = $derived(
  sceneFromModel(model, layout.checked, layout.annotations ?? []),
);

// Hover-to-show-docs and click-to-drill-down, shared with Explore. The embed
// navigates by swapping the `[...diagram]` route param, which is the only
// thing it decides for itself — and it now inherits the scroll-invariant popup
// anchoring it previously lacked.
function navigateToDetailView(path: string): void {
  const base = resolve("/projects/[id]/modeling/embed/[...diagram]", {
    id: projectId ?? "",
    diagram: path,
  });
  void goto(base);
}

let hoveredKey = $state<string | null>(null);
let hoverClient = $state<{ x: number; y: number } | null>(null);
let hoverPos = $state<{ x: number; y: number } | null>(null);

function onNodeHover(key: string | null, event?: MouseEvent): void {
  hoveredKey = key;
  hoverClient = event === undefined
    ? null
    : { x: event.clientX, y: event.clientY };
  hoverPos = anchorAt(canvasContainer, hoverClient);
}

function onNodeActivate(key: string): void {
  const diagram = detailViewFor(diagramEntries, scene, key);
  if (diagram !== undefined) {
    navigateToDetailView(diagram.path);
    return;
  }
  const label = scene.byKey.get(key)?.label ?? key;
  toastState.show(`No detailed view for ${label} created`, "info");
}

$effect(() =>
  trackPopupAnchor(() => {
    hoverPos = anchorAt(canvasContainer, hoverClient);
  })
);

let linkedComponents = $derived(
  new SvelteSet<string>(linkedKeysOf(diagramEntries, scene)),
);
let hoveredDoc = $derived(docFor(docs, scene, hoveredKey));
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
        onnodeclick={onNodeActivate}
        onnodehover={onNodeHover}
      />
      <DocPopup doc={hoveredDoc} position={hoverPos} />
    </div>
  {/if}
</div>
