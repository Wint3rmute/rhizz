<script lang="ts">
// Shared read-only diagram session for Explore, embed, and Inventory.
// Loads the project, compiles it, reads one layout, and draws the doc card.
// Callers own chrome and, when a node click should navigate, onOpenDiagram.
import type { ComponentJS, ConnectionJS } from "rhizz";
import { type Snippet, untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { getWarningLevel } from "../../../../WarningLevelState.svelte";
import { projectStore } from "../../../../ProjectState.svelte";
import { toastState } from "../../../../ToastState.svelte";
import { compile_system } from "../../../../rhizz_wasm_wrapper";
import { readProjectSources, type Source } from "../../../../vfs/compile";
import { type Dirent, openProjectFs } from "../../../../vfs/fs";
import { componentKeyAt, componentKeyIndex } from "../../../../modelKeys";
import Markdown from "../../../../components/Markdown.svelte";
import {
  type ProjectDoc,
  readProjectDocs,
  withFullNameHeader,
} from "../explore/docs";
import {
  findComponentDiagram,
  linkedComponentIndexes,
} from "../explore/navigation";
import {
  type Annotation,
  type DiagramLayout,
  emptyDiagramLayout,
  mapLayoutToBoxes,
  readDiagramLayoutFile,
  VIEW_LAYOUT_DIR,
} from "./persistence";
import type { DiagramStaticBox } from "./types";
import { fitCamera, sceneBounds } from "./blend";
import { buildReadOnlyScene } from "./scene";
import { createDiagramTransition } from "./transition.svelte";
import DiagramCanvas from "./DiagramCanvas.svelte";

export interface DiagramView {
  components: ComponentJS[];
  connections: ConnectionJS[];
  boxes: Record<number, DiagramStaticBox>;
  annotations: Annotation[];
  linked: Set<number>;
  onnodeclick: (index: number) => void;
  onnodehover: (index: number | null, event?: MouseEvent) => void;
}

let {
  projectId = null,
  diagramPath = null,
  onOpenDiagram,
  pending,
  whenEmpty,
  whenMissing,
  children,
}: {
  projectId?: string | null;
  /** Path relative to `views/`, e.g. `overview.hcl`. */
  diagramPath?: string | null;
  /** Navigate to a component's detail diagram. Omit for a preview that does not navigate; missing views then do not toast. */
  onOpenDiagram?: ((path: string) => void) | undefined;
  /** Shown until the layout file has loaded. Omit to render the picture immediately. */
  pending?: Snippet | undefined;
  /** Shown when the loaded layout has nothing placed. Omit to render an empty picture. */
  whenEmpty?: Snippet | undefined;
  /** Shown when `views/<diagramPath>` does not exist. Omit to treat that as an empty layout. */
  whenMissing?: Snippet | undefined;
  /** Picture to draw. Omit for the read-only static view (Explore). */
  children?: Snippet<[DiagramView]> | undefined;
} = $props();

let sources = $state<Source[]>([]);
let sourcesLoaded = $state(false);
let docs = $state<ProjectDoc[]>([]);
let viewportWidth = $state(0);
let viewportHeight = $state(0);
const stage = createDiagramTransition();
let presentedPath: string | null = null;
let layout = $state<DiagramLayout>(emptyDiagramLayout());
let layoutLoaded = $state(false);
let layoutMissing = $state(false);
let diagramEntries = $state<Dirent[]>([]);

$effect(() => {
  const id = projectId;
  if (!id) {
    sources = [];
    sourcesLoaded = true;
    docs = [];
    diagramEntries = [];
    return;
  }
  sourcesLoaded = false;
  let cancelled = false;
  const fs = openProjectFs(projectStore, id);
  readProjectSources(fs)
    .then((loaded) => {
      if (cancelled) return;
      sources = loaded;
      sourcesLoaded = true;
    })
    .catch(() => {
      if (cancelled) return;
      sources = [];
      sourcesLoaded = true;
    });
  readProjectDocs(fs)
    .then((loaded) => {
      if (!cancelled) docs = loaded;
    })
    .catch(() => {
      if (!cancelled) docs = [];
    });
  fs.readdir(VIEW_LAYOUT_DIR, { recursive: true })
    .then((entries) => {
      if (cancelled) return;
      diagramEntries = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith(".hcl"),
      );
    })
    .catch(() => {
      if (!cancelled) diagramEntries = [];
    });
  return () => {
    cancelled = true;
  };
});

$effect(() => {
  const id = projectId;
  const path = diagramPath;
  if (!id || !path) {
    layout = emptyDiagramLayout();
    layoutMissing = false;
    layoutLoaded = true;
    return;
  }
  layoutLoaded = false;
  layoutMissing = false;
  let cancelled = false;
  const fs = openProjectFs(projectStore, id);
  const fullPath = `${VIEW_LAYOUT_DIR}/${path}`;
  // Probe first: readDiagramLayoutFile turns a missing file into an empty
  // layout, and Inventory must tell "no file yet" from "file, nothing placed".
  fs.readFile(fullPath)
    .then(() => readDiagramLayoutFile(fs, fullPath))
    .then((loaded) => {
      if (cancelled) return;
      layout = loaded;
      layoutMissing = false;
      layoutLoaded = true;
    })
    .catch(() => {
      if (cancelled) return;
      layout = emptyDiagramLayout();
      layoutMissing = true;
      layoutLoaded = true;
    });
  return () => {
    cancelled = true;
  };
});

let warningLevel = $derived(getWarningLevel());
let output = $derived.by(() => {
  if (sources.length === 0) return null;
  try {
    return compile_system(sources, warningLevel);
  } catch {
    return null;
  }
});
let model = $derived(output ? output.model() : undefined);
let components = $derived(model ? model.components() : []);
let connections = $derived(model ? model.connections() : []);
let componentKeys = $derived(model ? model.component_keys() : []);
let keyToIndex = $derived(componentKeyIndex(model));
let boxes = $derived(mapLayoutToBoxes(layout.checked, keyToIndex));
let annotations = $derived(layout.annotations ?? []);
let linked = $derived(
  linkedComponentIndexes(components, componentKeys, diagramEntries),
);

let docsByLabel = $derived.by(() => {
  const map = new SvelteMap<string, string>();
  for (const doc of docs) map.set(doc.key, doc.content);
  return map;
});

let hoveredIndex = $state<number | null>(null);
let hoverClient = $state<{ x: number; y: number } | null>(null);
let hoverPos = $state<{ x: number; y: number } | null>(null);
let container = $state<HTMLDivElement | undefined>();

function positionPopup(): void {
  if (hoveredIndex === null || hoverClient === null || !container) {
    hoverPos = null;
    return;
  }
  const rect = container.getBoundingClientRect();
  hoverPos = {
    x: hoverClient.x - rect.left,
    y: hoverClient.y - rect.top,
  };
}

function onnodehover(index: number | null, event?: MouseEvent) {
  hoveredIndex = index;
  if (index === null || !event) {
    hoverClient = null;
    positionPopup();
    return;
  }
  hoverClient = { x: event.clientX, y: event.clientY };
  positionPopup();
}

// Re-anchor when a sidebar or the page scrolls under a stationary cursor.
// Capture phase, because `scroll` does not bubble.
$effect(() => {
  const onScroll = () => positionPopup();
  document.addEventListener("scroll", onScroll, true);
  return () => document.removeEventListener("scroll", onScroll, true);
});

let hoveredDoc = $derived.by(() => {
  if (hoveredIndex === null) return null;
  const component = components[hoveredIndex];
  const doc = docsByLabel.get(component?.label ?? "") ?? null;
  if (doc === null) return null;
  return withFullNameHeader(doc, component?.full_name ?? "");
});

function onnodeclick(index: number) {
  if (!onOpenDiagram) return;
  const component = components[index];
  if (!component) return;
  const diagram = findComponentDiagram(
    diagramEntries,
    component.label,
    componentKeyAt(componentKeys, index),
  );
  if (diagram) {
    onOpenDiagram(diagram.path);
    return;
  }
  toastState.show(`No detailed view for ${component.label} created`, "info");
}

let vacant = $derived(
  layoutLoaded &&
    Object.keys(boxes).length === 0 &&
    annotations.length === 0,
);

let desiredScene = $derived(
  buildReadOnlyScene({
    components,
    connections,
    boxes,
    annotations,
    linked,
    ids: componentKeys,
    dimUnlinked: onOpenDiagram !== undefined,
  }),
);

let ready = $derived(
  layoutLoaded && sourcesLoaded && !layoutMissing && diagramPath !== null &&
    viewportWidth > 0 && viewportHeight > 0,
);

$effect(() => {
  if (!ready || !diagramPath) return;
  const scene = desiredScene;
  const path = diagramPath;
  // The layout can arrive before its keys resolve onto the model. Fitting
  // then aims the camera at nothing; wait until the nodes are actually there.
  if (Object.keys(layout.checked).length > 0 && scene.nodes.length === 0) {
    return;
  }
  const bounds = sceneBounds(scene);
  const fit = bounds
    ? fitCamera(bounds, { width: viewportWidth, height: viewportHeight })
    : null;
  // show() writes the stage. Don't let that write resubscribe this effect.
  // A scene update for the path already on screen must not cancel a tween
  // that started because the path changed.
  untrack(() => {
    if (stage.settling && presentedPath === path) return;
    const switching = presentedPath !== null && presentedPath !== path;
    stage.show(scene, fit, {
      transition: switching,
      moveCamera: presentedPath === null || switching,
    });
    presentedPath = path;
  });
});

$effect(() => () => stage.destroy());
</script>

<div
  bind:this={container}
  bind:clientWidth={viewportWidth}
  bind:clientHeight={viewportHeight}
  class="relative flex h-full min-h-0 w-full flex-1 flex-col"
>
  {#if !layoutLoaded && pending}
    {@render pending()}
  {:else if layoutMissing && whenMissing}
    {@render whenMissing()}
  {:else if vacant && whenEmpty}
    {@render whenEmpty()}
  {:else if children}
    {@render children({
      components,
      connections,
      boxes,
      annotations,
      linked,
      onnodeclick,
      onnodehover,
    })}
  {:else}
    <svg
      width="100%"
      height="100%"
      viewBox="{stage.camera.x} {stage.camera.y} {Math.max(viewportWidth, 1) /
        stage.camera.zoom} {Math.max(viewportHeight, 1) / stage.camera.zoom}"
    >
      <DiagramCanvas
        scene={stage.shown ? stage.scene : desiredScene}
        linkNodes={onOpenDiagram !== undefined}
        frozen={stage.settling}
        onNodeClick={onOpenDiagram ? onnodeclick : undefined}
        onNodeHover={onnodehover}
      />
    </svg>
  {/if}
  {#if hoveredDoc && hoverPos}
    <div
      class="absolute z-30 max-w-sm pointer-events-none"
      style="left: {hoverPos.x + 12}px; top: {hoverPos.y + 12}px;"
    >
      <div
        class="card bg-base-100 border border-base-content/40 shadow-xl p-3"
        data-testid="explore-doc-tooltip"
      >
        <Markdown content={hoveredDoc} />
      </div>
    </div>
  {/if}
</div>
