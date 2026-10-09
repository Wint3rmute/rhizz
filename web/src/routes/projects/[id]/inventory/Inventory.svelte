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
import { applyModelMutation } from "../../../../history/applyMutation";
import type { ComponentPatch, SystemPatch } from "../../../../actionLog";
import type { PortData } from "../../../../modelView";
import { compile_system } from "../../../../rhizz_wasm_wrapper";
import { projectStore } from "../../../../ProjectState.svelte";
import {
  primaryHclPath,
  readProjectSources,
  type Source,
} from "../../../../vfs/compile";
import { openProjectFs } from "../../../../vfs/fs";
import type { RawModelPayload } from "../../../../modelView";
import { TOUR_TARGETS } from "../../../../tour/tourTargets";
import DiagramViewer from "../modeling/DiagramViewer.svelte";
import CreateComponentModal from "../modeling/CreateComponentModal.svelte";
import CreateSystemModal from "../modeling/CreateSystemModal.svelte";
import {
  emptyDiagramLayout,
  parse_views,
  VIEW_LAYOUT_DIR,
  writeDiagramLayoutFile,
} from "../modeling/persistence";
import DefinitionCard from "./DefinitionCard.svelte";
import DetailPane from "./DetailPane.svelte";
import Pane from "./Pane.svelte";
import Splitter from "./Splitter.svelte";
import {
  hideInventoryPanel,
  type InventoryLayout,
  readInventoryLayout,
  resizeInventoryPanel,
  showInventoryPanel,
  writeInventoryLayout,
} from "./inventoryLayout";
import {
  defaultViewPath,
  definitionLabelForNode,
  filterDefinitions,
  filterSystems,
  instancePathsForDefinition,
  INVENTORY_TABS,
  type InventoryDefinition,
  type InventorySystem,
  InventoryTab,
  preferredViewSystem,
  systemAsDefinition,
  viewsBoundToSystem,
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
let activeTab = $state<InventoryTab>(InventoryTab.Components);
let query = $state("");
let selectedLabel = $state<string | null>(null);

// ── Modular workspace layout ────────────────────────────────────────────────
// Panel widths + hidden flags in one serializable store, persisted across
// reloads. Resizes clamp via `resizeInventoryPanel`; hide/restore preserve
// widths so a restored panel comes back exactly as it was.
let layout = $state<InventoryLayout>(readInventoryLayout());

$effect(() => {
  writeInventoryLayout(layout);
});

// Systems come straight from the compiled payload (`raw.systems`), in model
// order — the same source `model.systems()` reads, but with full_name/icon/
// tags for search and cards.
let systems = $derived.by<InventorySystem[]>(() =>
  (raw?.systems ?? []).map((s) => ({
    label: s.label,
    full_name: s.full_name ?? "",
    icon: s.icon,
    tags: s.tags ?? [],
  }))
);

let filtered = $derived(
  filterDefinitions(definitions, { tab: activeTab, query }),
);

let filteredSystems = $derived(filterSystems(systems, query));

// The rows the sidebar actually shows for the active tab.
let visibleLabels = $derived(
  activeTab === InventoryTab.Systems
    ? filteredSystems.map((s) => s.label)
    : filtered.map((d) => d.label),
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
    replace,
    reset: false,
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
    (definitions.some((d) => d.label === requested) ||
      systems.some((s) => s.label === requested));
  if (isOpenable) {
    selectedLabel = requested;
    // Keep the tab on the kind that holds the deep-linked entity, so the
    // sidebar shows the open row instead of falling back elsewhere.
    if (systems.some((s) => s.label === requested)) {
      activeTab = InventoryTab.Systems;
    } else if (definitions.some((d) => d.label === requested)) {
      activeTab = InventoryTab.Components;
    }
    return;
  }
  // Nothing openable in the path — a bare page, or an entity that has since
  // been renamed or deleted. The open entity has to be one the current filter
  // still shows, so fall back to the first match and take the URL with it:
  // the address bar must keep naming what the detail pane is showing.
  if (visibleLabels.length === 0) {
    if (selectedLabel !== null) selectLabel(null, true);
    return;
  }
  if (
    selectedLabel !== null && visibleLabels.includes(selectedLabel)
  ) return;
  selectLabel(visibleLabels[0] ?? null, true);
});

let selectedDefinition = $derived.by<InventoryDefinition | null>(() => {
  const fromComponents = filtered.find((d) => d.label === selectedLabel);
  if (fromComponents) return fromComponents;
  // Systems reuse the definition card/preview/pane via a synthetic
  // definition — the diagram convention is the same (`views/<label>.hcl`).
  const sys = filteredSystems.find((s) => s.label === selectedLabel);
  if (sys) return systemAsDefinition(sys);
  // The selection may be hidden by the current tab's filter (e.g. a
  // deep link resolved before the tab switch, or a click that cleared it)
  // — still show it rather than a blank pane.
  const anyDef = definitions.find((d) => d.label === selectedLabel);
  if (anyDef) return anyDef;
  const anySys = systems.find((s) => s.label === selectedLabel);
  return anySys ? systemAsDefinition(anySys) : null;
});

// Whether the open entity is a system (rather than a component definition).
// Decides what `handleCreateView` binds the new view to: a system binds to
// itself, a definition binds to the system that instantiates it.
let selectedIsSystem = $derived(
  selectedLabel !== null && systems.some((s) => s.label === selectedLabel),
);

// ── Clicking a node in the preview focuses the inventory on it ──────────────
//
// A node in the preview is a component the user can point at, so clicking it
// does what clicking its card does — `selectLabel`, and therefore the same URL
// change and the same back/forward. Explore's node click is the same idea one
// page over. What a click *means* is decided here because it is this list's
// question; see definitionLabelForNode.
let definitionLabels = $derived(definitions.map((d) => d.label));

function handleSelectNode(index: number): void {
  const label = definitionLabelForNode(raw, definitionLabels, index);
  // Nothing to focus, and saying so would be noise on a canvas that is only a
  // preview.
  if (label === null) return;
  // This list's own rule is that the open entity is one the current filter
  // still shows, and the URL effect below would enforce it by falling back to
  // the first row — undoing the click. Clear the filter instead, so the click
  // lands on the component that was pointed at.
  if (!visibleLabels.includes(label)) {
    query = "";
    activeTab = InventoryTab.Components;
  }
  selectLabel(label);
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

async function handleSaveDoc(label: string, content: string): Promise<void> {
  const id = projectId;
  if (!id) return;
  const fs = openProjectFs(projectStore, id);
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile(`docs/${label}.md`, content);
  // A debounced write can land after an entity switch: only refresh the
  // viewer state when its entity is still selected, otherwise the new
  // selection would flash "Loading…" until its own load lands. Reopening
  // the written entity reads the file fresh anyway.
  if (selectedDefinition?.label !== label) return;
  selectedDoc = content;
  selectedDocLabel = label;
}

// Creates a new system or component definition from the sidebar button
// (above the search box). Both kinds go through a creation modal: systems
// through a name-only `CreateSystemModal`, components through the shared
// `CreateComponentModal` locked to "New Component Definition" (no instance
// placement from here — this page only adds top-level definitions). A blank,
// slash-containing or already-taken name is a silent no-op. On success the
// list refreshes from disk and the new entity is selected.
let creatingEntity = $state(false);
let isCreateModalOpen = $state(false);
let isCreateSystemModalOpen = $state(false);

// Parents the modal's inspector shows alongside the new definition's key.
// Nothing is ever placed under them from here — the modal needs the list,
// and the systems are the only containers this page knows.
let modalParents = $derived(
  systems.map((s) => ({
    key: s.label,
    label: s.label,
    isSystem: true,
    path: s.label,
  })),
);

async function handleAddEntity(): Promise<void> {
  const id = projectId;
  if (!id || creatingEntity) return;
  const isSystem = activeTab === InventoryTab.Systems;
  if (!isSystem && activeTab !== InventoryTab.Components) return;
  if (isSystem) {
    isCreateSystemModalOpen = true;
    return;
  }
  isCreateModalOpen = true;
}

async function handleSystemCreate(label: string): Promise<void> {
  isCreateSystemModalOpen = false;
  const id = projectId;
  if (!id || creatingEntity) return;
  const trimmed = label.trim();
  if (trimmed === "" || trimmed.includes("/")) return;
  // The system is already there — open it rather than writing a no-op.
  if (systems.some((s) => s.label === trimmed)) {
    selectLabel(trimmed);
    return;
  }
  creatingEntity = true;
  try {
    const fs = openProjectFs(projectStore, id);
    const targetPath = primaryHclPath(
      await fs.readdir(".", { recursive: true }),
    );
    const content = await fs.readFile(targetPath).catch(() => "");
    const result = await applyModelMutation(fs, targetPath, content, {
      kind: "add_system",
      label: trimmed,
    });
    if (!result.applied) return;
    sources = await readProjectSources(fs);
    selectLabel(trimmed);
  } catch (error) {
    console.error("Failed to create inventory entity:", error);
  } finally {
    creatingEntity = false;
  }
}

async function handleModalCreate(data: {
  label: string;
  full_name: string;
  tags: string[];
  leaf: boolean;
  ports: PortData[];
}): Promise<void> {
  isCreateModalOpen = false;
  const id = projectId;
  if (!id || creatingEntity) return;
  const label = data.label.trim();
  if (label === "" || label.includes("/")) return;
  // The definition is already there — open it rather than writing a no-op.
  if (definitions.some((d) => d.label === label)) {
    selectLabel(label);
    return;
  }
  creatingEntity = true;
  try {
    const fs = openProjectFs(projectStore, id);
    const targetPath = primaryHclPath(
      await fs.readdir(".", { recursive: true }),
    );
    const content = await fs.readFile(targetPath).catch(() => "");
    const result = await applyModelMutation(fs, targetPath, content, {
      kind: "add_component_definition",
      label,
      options: {
        leaf: data.leaf,
        full_name: data.full_name,
        tags: data.tags,
        ports: data.ports,
      },
    });
    if (!result.applied) return;
    sources = await readProjectSources(fs);
    selectLabel(label);
  } catch (error) {
    console.error("Failed to create inventory entity:", error);
  } finally {
    creatingEntity = false;
  }
}

// The path is the definition's own label, which is what `update_component`
// expects for a top-level definition. A system label is not a component path
// at all and would be refused, which is why systems go through
// `handleSystemStyleChange` (`update_system`) instead.
let applyingStyle = $state(false);

async function applyStyleOp(
  op: { kind: "update_component"; patch: ComponentPatch } | {
    kind: "update_system";
    patch: SystemPatch;
  },
  errorMessage: string,
): Promise<void> {
  const id = projectId;
  const label = selectedDefinition?.label;
  if (!id || !label || applyingStyle) return;
  applyingStyle = true;
  try {
    const fs = openProjectFs(projectStore, id);
    const targetPath = primaryHclPath(
      await fs.readdir(".", { recursive: true }),
    );
    const content = await fs.readFile(targetPath).catch(() => "");
    const result = await applyModelMutation(fs, targetPath, content, {
      ...op,
      path: label,
    });
    if (!result.applied) return;
    sources = await readProjectSources(fs);
  } catch (error) {
    console.error(errorMessage, error);
  } finally {
    applyingStyle = false;
  }
}

async function handleStyleChange(patch: ComponentPatch): Promise<void> {
  await applyStyleOp(
    { kind: "update_component", patch },
    "Failed to update inventory component style:",
  );
}

// Systems carry only `full_name` and `icon`: the `SystemPatch` type keeps
// component-only keys from reaching the op, where Rust rejects them.
async function handleSystemStyleChange(patch: SystemPatch): Promise<void> {
  await applyStyleOp(
    { kind: "update_system", patch },
    "Failed to update inventory system style:",
  );
}

// ── Deletion ───────────────────────────────────────────────────────────────
// The Delete tab blocks while the entity is still referenced: a component
// with live instances (its placements, by model key), a system with bound
// views (which would dangle with E006). The blockers are recomputed from
// the compiled model + sources on every render, so removing the last
// instance/view unlocks the confirm input without a reload.
let deleteBlockers = $derived.by<string[]>(() => {
  const label = selectedDefinition?.label;
  if (!label) return [];
  if (selectedIsSystem) {
    return viewsBoundToSystem(boundViews, label);
  }
  return instancePathsForDefinition(
    comps,
    model?.component_keys() ?? [],
    label,
  );
});

// Every `views/*.hcl` file with its bound system, parsed from the project
// sources. Malformed view files are skipped — they are someone else's
// diagnostic, not this tab's problem.
let boundViews = $derived.by<{ path: string; system: string }[]>(() => {
  const views: { path: string; system: string }[] = [];
  for (const source of sources) {
    if (!source.filename.startsWith(`${VIEW_LAYOUT_DIR}/`)) continue;
    if (!source.filename.endsWith(".hcl")) continue;
    try {
      for (const view of parse_views(source.content)) {
        views.push({ path: source.filename, system: view.system ?? "" });
      }
    } catch { /* Skip unparseable view files. */ }
  }
  return views;
});

async function handleDeleteEntity(): Promise<void> {
  const id = projectId;
  const label = selectedDefinition?.label;
  if (!id || !label) return;
  try {
    const fs = openProjectFs(projectStore, id);
    const targetPath = primaryHclPath(
      await fs.readdir(".", { recursive: true }),
    );
    const content = await fs.readFile(targetPath).catch(() => "");
    const result = await applyModelMutation(
      fs,
      targetPath,
      content,
      selectedIsSystem
        ? { kind: "delete_system", path: label }
        : { kind: "delete_component", path: label },
    );
    if (!result.applied) return;
    sources = await readProjectSources(fs);
    selectLabel(null);
  } catch (error) {
    console.error("Failed to delete inventory entity:", error);
  }
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
    // A system binds its view to itself; a definition binds to the system
    // that instantiates it. Either way the diagram lives at
    // `views/<label>.hcl` — the same name the preview already probed.
    const system = selectedIsSystem ? def.label : preferredViewSystem(
      comps,
      model?.systems().map((s) => s.label) ?? [],
      def.label,
    );
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
    console.error("Failed to create inventory view:", error);
  } finally {
    creatingView = false;
  }
}
</script>

<div
  data-testid="inventory-workspace"
  class="flex flex-col md:flex-row flex-1 w-full h-screen overflow-hidden bg-base-300"
>
  {#if !projectId}
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="card bg-base-200 shadow-xl">
        <div class="card-body items-center text-center">
          <h2 class="card-title">No project selected</h2>
          <p class="text-base-content/60 text-sm">
            Select or create a project to browse its inventory.
          </p>
          <a href={resolve("/projects")} class="btn btn-primary mt-2">
            Back to projects
          </a>
        </div>
      </div>
    </div>
  {:else}
    <!-- Left panel: Inventory Browser. The Pane owns the header, width and
         hide/restore rail; the browser content below is unchanged. -->
    <Pane
      title="Inventory Browser"
      side="left"
      width={layout.leftWidth}
      hidden={layout.leftHidden}
      onhide={() => (layout = hideInventoryPanel(layout, "left"))}
      onshow={() => (layout = showInventoryPanel(layout, "left"))}
    >
      <div class="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden p-3">
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
            {tab === InventoryTab.Components
              ? "Components"
              : tab === InventoryTab.Systems
              ? "Systems"
              : "Interfaces"}
          </button>
        {/each}
      </div>

      {#if activeTab !== InventoryTab.Interfaces}
        <button
          type="button"
          class="btn btn-primary btn-sm w-full"
          disabled={creatingEntity}
          onclick={() => void handleAddEntity()}
          data-testid="inventory-add-entity"
        >
          {creatingEntity
            ? "Creating…"
            : activeTab === InventoryTab.Systems
            ? "+ New System"
            : "+ New Component"}
        </button>
      {/if}
      <div class="divider my-0"></div>

      <!-- Free-text search -->
      <input
        type="search"
        class="input input-sm input-bordered w-full"
        placeholder="Search inventory…"
        aria-label="Search inventory"
        bind:value={query}
      />

      <!-- Entity list -->
      <div
        class="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 min-h-0"
      >
        {#if activeTab === InventoryTab.Systems}
          {#if filteredSystems.length === 0}
            <div class="flex-1 flex items-center justify-center text-sm text-base-content/50 p-4 text-center">
              {#if systems.length === 0}
                No systems in this model yet.
              {:else}
                Nothing matches "{query}".
              {/if}
            </div>
          {:else}
            {#each filteredSystems.map(systemAsDefinition) as definition (definition.label)}
              <DefinitionCard
                {definition}
                selected={definition.label === selectedLabel}
                showLevel={false}
                onselect={(label) => selectLabel(label)}
              />
            {/each}
          {/if}
        {:else if filtered.length === 0}
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
      </div>
    </Pane>

    <Splitter
      side="left"
      value={layout.leftWidth}
      hidden={layout.leftHidden}
      onresize={(dx) =>
        (layout = resizeInventoryPanel(
          layout,
          "left",
          layout.leftWidth + dx,
        ))}
    />

    <!-- Centre: the diagram preview fills whatever the panels leave over. -->
    <div class="flex flex-1 min-w-0 min-h-0">
      <div
        data-testid="inventory-diagram"
        class="relative flex-1 min-w-0 min-h-[320px] md:min-h-0 bg-base-300 flex items-center justify-center overflow-hidden"
      >
        {#if selectedDefinition}
          <DiagramViewer
            {projectId}
            diagramPath={`${selectedDefinition.label}.hcl`}
            onSelectComponent={handleSelectNode}
            linkLabel={(node) => `${node.label}, open in inventory`}
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
                        : selectedIsSystem
                        ? "Create a view for this system"
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
    </div>

    <Splitter
      side="right"
      value={layout.rightWidth}
      hidden={layout.rightHidden}
      onresize={(dx) =>
        (layout = resizeInventoryPanel(
          layout,
          "right",
          layout.rightWidth - dx,
        ))}
    />

    <!-- Right panel: entity details. The DetailPane content is unchanged. -->
    <Pane
      title="Details"
      side="right"
      width={layout.rightWidth}
      hidden={layout.rightHidden}
      onhide={() => (layout = hideInventoryPanel(layout, "right"))}
      onshow={() => (layout = showInventoryPanel(layout, "right"))}
    >
      <DetailPane
        definition={selectedDefinition}
        docContent={docContent}
        ondocsave={handleSaveDoc}
        onstylechange={selectedIsSystem ? undefined : handleStyleChange}
        onsystemstylechange={selectedIsSystem
          ? handleSystemStyleChange
          : undefined}
        deleteBlockers={deleteBlockers}
        deleteBlockerKind={selectedIsSystem ? "view" : "instance"}
        ondelete={handleDeleteEntity}
      />
    </Pane>

    <CreateComponentModal
      isOpen={isCreateModalOpen}
      availableParents={modalParents}
      reusableDefinitions={[]}
      allowReuse={false}
      defaultParentKey={modalParents[0]?.key}
      oncreate={(data) => void handleModalCreate(data)}
      onclose={() => (isCreateModalOpen = false)}
    />
    <CreateSystemModal
      isOpen={isCreateSystemModalOpen}
      oncreate={(label) => void handleSystemCreate(label)}
      onclose={() => (isCreateSystemModalOpen = false)}
    />
  {/if}
</div>
