<script lang="ts">
// Inventory Browser: lists every component *definition* (never instances)
// in the compiled model, with a read-only preview of the definition's
// default diagram (`views/<label>.hcl`) and a tabbed detail pane.
//
// Data is taken from the compiled model's raw payload (`model.to_js()`),
// which — unlike the typed wasm wrappers — exposes children/ports/parent
// indices needed to reconstruct definition trees and hierarchy paths.
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { page } from "$app/state";
import { compile_system } from "../../../../rhizz_wasm_wrapper";
import { projectStore } from "../../../../ProjectState.svelte";
import { readProjectSources, type Source } from "../../../../vfs/compile";
import { openProjectFs } from "../../../../vfs/fs";
import type { RawModelPayload } from "../../../../modelView";
import { TOUR_TARGETS } from "../../../../tour/tourTargets";
import DiagramViewer from "../modeling/DiagramViewer.svelte";
import {
  emptyDiagramLayout,
  VIEW_LAYOUT_DIR,
  writeDiagramLayoutFile,
} from "../modeling/persistence";
import DefinitionCard from "./DefinitionCard.svelte";
import DetailPane from "./DetailPane.svelte";
import {
  defaultViewPath,
  definitionLabelForNode,
  filterDefinitions,
  INVENTORY_TABS,
  type InventoryDefinition,
  InventoryTab,
  preferredViewSystem,
} from "./inventory";

let {
  projectId = null,
  requestedLabel = "",
}: {
  projectId?: string | null;
  /** The entity named by the route path ("" = none requested). */
  requestedLabel?: string;
} = $props();

// ── Model state (compiled from the project's HCL sources) ──────────────────
let sources = $state<Source[]>([]);
// Whether the model has been read (or found unreadable) — see `modelReady`
// under the URL section below, which waits for this before resolving the URL.
let modelReady = $state(false);

$effect(() => {
  const id = projectId;
  modelReady = false;
  if (!id) {
    sources = [];
    modelReady = true;
    return;
  }
  let cancelled = false;
  const fs = openProjectFs(projectStore, id);
  readProjectSources(fs)
    .then((loaded) => {
      if (!cancelled) sources = loaded;
    })
    .catch(() => {
      if (!cancelled) sources = [];
    })
    .finally(() => {
      if (!cancelled) modelReady = true;
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
let raw = $derived(
  model ? (model.to_js() as RawModelPayload) : undefined,
);
let comps = $derived(raw?.components ?? []);
let rawPorts = $derived(raw?.ports ?? []);

// ── Definitions extracted from the compiled model ──────────────────────────
// `raw.definitions` holds the arena indices of the top-level reusable
// definitions (retained even with zero instances). Instances are never
// listed — only these definition subtrees.
let definitions = $derived.by<InventoryDefinition[]>(() => {
  const list: InventoryDefinition[] = [];
  for (const cid of raw?.definitions ?? []) {
    const build = (index: number): InventoryDefinition => {
      const c = comps[index];
      if (!c) {
        return {
          label: `#${index}`,
          full_name: "",
          tags: [],
          level: 1,
          leaf: false,
          children: [],
          ports: [],
        };
      }
      return {
        label: c.label,
        full_name: c.full_name ?? "",
        tags: c.tags ?? [],
        level: c.level ?? 1,
        leaf: c.leaf ?? false,
        icon: c.icon,
        color: c.color,
        border: c.border,
        font: c.font,
        children: (c.children ?? []).map((child: number) => build(child)),
        ports: (c.ports ?? []).map((pid: number) => {
          const p = rawPorts[pid];
          return {
            label: p?.label ?? `#${pid}`,
            protocol: p?.protocol ?? "",
            role: p?.role ?? "peer",
            external: p?.external ?? false,
            required: p?.required ?? true,
            full_name: p?.full_name ?? "",
          };
        }),
      };
    };
    list.push(build(cid));
  }
  return list;
});

// ── Sidebar state ───────────────────────────────────────────────────────────
let activeTab = $state<InventoryTab>(InventoryTab.All);
let query = $state("");
let selectedLabel = $state<string | null>(null);

let filtered = $derived(
  filterDefinitions(definitions, { tab: activeTab, query }),
);

// ── The inspected entity lives in the URL path ─────────────────────────────
//
// `/projects/<id>/inventory/<label>`, so the address bar always names what the
// detail pane shows: it can be shared, bookmarked, and the browser's
// back/forward buttons move between entities. `selectedLabel` stays the source
// of truth for rendering and the URL mirrors it in both directions — clicks go
// through selectLabel, the URL is only ever *adopted* (see the effect below),
// so the two can never fight. Same shape as Modeling's open view.
function labelUrl(label: string | null): string {
  return resolve("/projects/[id]/inventory/[...label]", {
    id: projectId ?? "",
    label: label ?? "",
  });
}

// Opens `label` (or nothing, for the bare page) and makes the URL name it.
// `replace` rewrites the current history entry instead of pushing a new one —
// used when the URL is being canonicalised (a bare page, a search that hides
// the open entity) rather than moved to by the user.
function selectLabel(label: string | null, replace = false): void {
  selectedLabel = label;
  const target = labelUrl(label);
  if (target === page.url.pathname) return;
  void goto(target, {
    replaceState: replace,
    noScroll: true,
    keepFocus: true,
  });
}

// The last entity this page settled on. Non-reactive: it exists so a
// navigation this page performed itself (selectLabel writes the state first,
// the URL a tick later) is not mistaken for the user pressing back, which
// would undo the very click that caused it.
let lastHandledLabel: string | null = null;

$effect(() => {
  // Before the model is read there is nothing to resolve the path against —
  // and a cold deep link would be rewritten to the bare page if we tried.
  if (!modelReady) return;
  const requested = requestedLabel;
  // Already settled — this is our own navigation echoing back (or a filter
  // change re-running the effect), not a new entity to open.
  if (requested === lastHandledLabel) return;
  lastHandledLabel = requested;
  const isOpenable = requested !== "" &&
    definitions.some((d) => d.label === requested);
  if (isOpenable) {
    selectedLabel = requested;
    return;
  }
  // Nothing openable in the path — a bare page, or an entity that has since
  // been renamed or deleted. The open entity has to be one the current filter
  // still shows, so fall back to the first match and take the URL with it:
  // the address bar must keep naming what the detail pane is showing.
  if (filtered.length === 0) {
    if (selectedLabel !== null) selectLabel(null, true);
    return;
  }
  if (filtered.some((d) => d.label === selectedLabel)) return;
  selectLabel(filtered[0]?.label ?? null, true);
});

let selectedDefinition = $derived(
  filtered.find((d) => d.label === selectedLabel) ?? null,
);

// ── Clicking a node in the preview focuses the inventory on it ──────────────
//
// The preview is a diagram of the open definition, and a node in it is a
// component the user can see and point at, so clicking it should do what
// clicking its card does — which is `selectLabel`, and therefore the same URL
// change, the same shareable address, and the same back/forward. Explore's
// node click is the same idea one page over: navigate, and let the URL say so.
//
// The click arrives as a model index, which the diagram shares with
// `raw.components` (see componentDataByKey), and what it *means* is decided
// here because it is this list's question: a node answers with the definition
// it came from, which is not the label drawn on it when an instance was renamed
// at its usage site.
let definitionLabels = $derived(definitions.map((d) => d.label));

function handleSelectNode(index: number): void {
  const label = definitionLabelForNode(raw, definitionLabels, index);
  // A node this page cannot open — a system, or an instance of something that
  // is no longer a definition — has nowhere to go, and saying so would be
  // noise on a canvas that is only a preview.
  if (label === null) return;
  // This list's own rule is that the open entity is one the current filter
  // still shows, and the URL effect below would enforce it by falling back to
  // the first row — undoing the click. Clear the filter instead, so the click
  // lands on the component that was pointed at.
  if (!filtered.some((d) => d.label === label)) {
    query = "";
    activeTab = InventoryTab.All;
  }
  selectLabel(label);
}

// Not the canvas's default wording, which is about opening a detailed view: on
// this page the click focuses the inventory, and a link that announces
// something else is a small lie to anyone listening.
function nodeLinkLabel(node: { label: string }): string {
  return `${node.label}, open in inventory`;
}

let emptyStatePath = $derived(
  selectedDefinition ? defaultViewPath(selectedDefinition.label) : null,
);

// Creates the missing component-specific view (`views/<label>.hcl`, bound
// ── Documentation loading ───────────────────────────────────────────────────
// The selected definition's doc is the VFS file `docs/<label>.md` (same
// convention as Modeling's "Open documentation"). `selectedDoc` holds the
// file content, or null when the file is missing; `selectedDocLabel` guards
// against flashing the previous definition's doc while the new one loads.
let selectedDoc = $state<string | null>(null);
let selectedDocLabel = $state<string | null>(null);

$effect(() => {
  const id = projectId;
  const label = selectedDefinition?.label;
  if (!id || !label) {
    selectedDoc = null;
    selectedDocLabel = label ?? null;
    return;
  }
  let cancelled = false;
  const fs = openProjectFs(projectStore, id);
  fs.readFile(`docs/${label}.md`)
    .then((content) => {
      if (cancelled) return;
      selectedDoc = content;
      selectedDocLabel = label;
    })
    .catch(() => {
      if (cancelled) return;
      selectedDoc = null;
      selectedDocLabel = label;
    });
  return () => {
    cancelled = true;
  };
});

// undefined while the newly-selected definition's doc is still loading.
let docContent = $derived(
  selectedDocLabel === selectedDefinition?.label ? selectedDoc : undefined,
);

async function handleSaveDoc(content: string): Promise<void> {
  const id = projectId;
  const label = selectedDefinition?.label;
  if (!id || !label) return;
  const fs = openProjectFs(projectStore, id);
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile(`docs/${label}.md`, content);
  selectedDoc = content;
  selectedDocLabel = label;
}

// Creates the missing component-specific view (`views/<label>.hcl`, bound
// to the system that instantiates the definition) and opens Modeling on that
// very view, addressed by its path.
let creatingView = $state(false);

async function handleCreateView(): Promise<void> {
  const def = selectedDefinition;
  const id = projectId;
  if (!def || !id || creatingView) return;
  creatingView = true;
  try {
    const fs = openProjectFs(projectStore, id);
    const systems = model?.systems().map((s) => s.label) ?? [];
    const system = preferredViewSystem(comps, systems, def.label);
    const path = defaultViewPath(def.label);
    await writeDiagramLayoutFile(fs, path, emptyDiagramLayout(system), system);
    // The view's own path relative to `views/` — the modeling route is a rest
    // param, so this is a plain path suffix, `views/` already being implied.
    await goto(
      resolve("/projects/[id]/modeling/[...view]", {
        id,
        view: path.slice(`${VIEW_LAYOUT_DIR}/`.length),
      }),
    );
  } catch (error) {
    console.error("Failed to create component view:", error);
  } finally {
    creatingView = false;
  }
}
</script>

<div class="flex flex-1 w-full h-screen overflow-hidden bg-base-300">
  {#if !projectId}
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="card bg-base-200 shadow-xl">
        <div class="card-body items-center text-center">
          <h2 class="card-title">No project selected</h2>
          <p class="text-base-content/60 text-sm">
            Select or create a project to browse its inventory.
          </p>
          <a href={resolve("/projects", {})} class="btn btn-primary mt-2">
            Back to projects
          </a>
        </div>
      </div>
    </div>
  {:else}
    <!-- Left sidebar: Inventory Browser -->
    <aside
      class="w-full shrink-0 bg-base-100 text-base-content border-r border-base-300 p-3 md:w-80 flex flex-col gap-3 overflow-hidden"
    >
      <h2 class="font-semibold text-lg">Inventory Browser</h2>

      <!-- Filter tabs -->
      <div
        class="flex items-center gap-1"
        role="tablist"
        aria-label="Inventory filters"
        data-tour={TOUR_TARGETS.inventory}
      >
        {#each INVENTORY_TABS as tab (tab)}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            class="btn btn-xs {activeTab === tab
              ? 'btn-primary'
              : 'btn-ghost'}"
            onclick={() => (activeTab = tab)}
          >
            {tab === InventoryTab.All
              ? "All"
              : tab === InventoryTab.Components
              ? "Components"
              : "Interfaces"}
          </button>
        {/each}
      </div>

      <!-- Free-text search -->
      <input
        type="search"
        class="input input-sm input-bordered w-full"
        placeholder="Search inventory…"
        aria-label="Search inventory"
        bind:value={query}
      />

      <!-- Definition list -->
      <div
        class="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 min-h-0"
      >
        {#if filtered.length === 0}
          <div class="flex-1 flex items-center justify-center text-sm text-base-content/50 p-4 text-center">
            {#if definitions.length === 0}
              No component definitions in this model yet.
            {:else if activeTab === InventoryTab.Interfaces}
              Interface entities are not available yet.
            {:else}
              Nothing matches "{query}".
            {/if}
          </div>
        {:else}
          {#each filtered as definition (definition.label)}
            <DefinitionCard
              {definition}
              selected={definition.label === selectedLabel}
              onselect={(label) => selectLabel(label)}
            />
          {/each}
        {/if}
      </div>
    </aside>

    <!-- Main row: the diagram preview and the detail pane share it, the pane
         to the right of the diagram. The split is 60/40 in the diagram's
         favour — a canvas is what you look at, the pane is what you consult —
         so the pane takes two fifths and the diagram absorbs the rest, and the
         split holds at any window width. Below `md` they stack. -->
    <div class="flex flex-col md:flex-row flex-1 min-w-0 min-h-0">
      <div
        data-testid="inventory-diagram"
        class="relative flex-1 min-w-0 min-h-[320px] md:min-h-0 bg-base-300 flex items-center justify-center overflow-hidden"
      >
        {#if selectedDefinition}
          <DiagramViewer
            {projectId}
            diagramPath={`${selectedDefinition.label}.hcl`}
            onSelectComponent={handleSelectNode}
            linkLabel={nodeLinkLabel}
          >
            {#snippet whenMissing()}
              <div
                class="flex h-full w-full items-center justify-center p-6 text-center"
                data-testid="inventory-empty-diagram"
              >
                <div class="card bg-base-200/80 border border-base-content/10">
                  <div class="card-body items-center max-w-md">
                    <p class="text-sm text-base-content/70">
                      Please create a default view diagram under
                      <code class="text-base-content bg-base-300 rounded px-1 py-0.5">
                        {emptyStatePath}
                      </code>
                    </p>
                    <button
                      type="button"
                      class="btn btn-primary btn-sm mt-3"
                      disabled={creatingView}
                      onclick={() => void handleCreateView()}
                      data-testid="inventory-create-view"
                    >
                      {creatingView
                        ? "Creating…"
                        : "Create a view for this component"}
                    </button>
                  </div>
                </div>
              </div>
            {/snippet}
          </DiagramViewer>
        {:else}
          <div
            class="flex h-full w-full items-center justify-center text-sm text-base-content/60 p-4 text-center"
          >
            Select an entity to preview its default diagram.
          </div>
        {/if}
      </div>

      <DetailPane
        definition={selectedDefinition}
        docContent={docContent}
        ondocsave={handleSaveDoc}
      />
    </div>
  {/if}
</div>
