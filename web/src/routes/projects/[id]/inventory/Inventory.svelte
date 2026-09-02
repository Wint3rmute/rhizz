<script lang="ts">
// Inventory Browser: lists every component *definition* (never instances)
// in the compiled model, with a read-only preview of the definition's
// default diagram (`diagrams/<label>.hcl`) and a tabbed detail pane.
//
// Read-only by design: no model mutations are dispatched here; the Edit
// button deep-links into the Diagrams editor instead.
//
// Data is taken from the compiled model's raw payload (`model.to_js()`),
// which — unlike the typed wasm wrappers — exposes children/ports/parent
// indices needed to reconstruct definition trees and hierarchy paths.
import { SvelteMap } from "svelte/reactivity";
import { resolve } from "$app/paths";
import { compile_system } from "../../../../rhizz_wasm_wrapper";
import { projectStore } from "../../../../ProjectState.svelte";
import { readProjectSources, type Source } from "../../../../vfs/compile";
import { openProjectFs } from "../../../../vfs/fs";
import DiagramStaticView from "../diagrams/DiagramStaticView.svelte";
import {
  type DiagramLayout,
  emptyDiagramLayout,
  readDiagramLayoutFile,
} from "../diagrams/persistence";
import type {
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "../diagrams/types";
import DefinitionCard from "./DefinitionCard.svelte";
import DetailPane from "./DetailPane.svelte";
import {
  defaultDiagramPath,
  filterDefinitions,
  INVENTORY_TABS,
  type InventoryDefinition,
  InventoryTab,
} from "./inventory";

// Raw model payload shape (mirrors RawModelPayload in DocumentStore.svelte.ts;
// duplicated here so Inventory does not instantiate a mutable DocumentStore).
interface RawComponent {
  label: string;
  source?: string;
  kind?: string;
  parent?: { Component?: number; System?: number };
  description?: string;
  icon?: string;
  color?: string;
  border?: string;
  font?: string;
  tags?: string[];
  level?: number;
  leaf?: boolean;
  ports?: number[];
  children?: number[];
}
interface RawPort {
  label: string;
  description?: string;
  protocol?: string;
  role?: string;
  external?: boolean;
  required?: boolean;
}
interface RawConnection {
  label: string;
  from: { component: number; port?: number | null };
  to: { component: number; port?: number | null };
}
interface RawModel {
  components?: RawComponent[];
  definitions?: number[];
  systems?: { label: string; components?: number[]; connections?: number[] }[];
  ports?: RawPort[];
  connections?: RawConnection[];
}

let {
  projectId = null,
}: {
  projectId?: string | null;
} = $props();

// ── Model state (compiled from the project's HCL sources) ──────────────────
let sources = $state<Source[]>([]);

$effect(() => {
  const id = projectId;
  if (!id) {
    sources = [];
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
let raw = $derived(model ? (model.to_js() as RawModel) : undefined);
let comps = $derived(raw?.components ?? []);
let rawPorts = $derived(raw?.ports ?? []);
let rawConnections = $derived(raw?.connections ?? []);

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
          description: "",
          tags: [],
          level: 1,
          leaf: false,
          children: [],
          ports: [],
        };
      }
      return {
        label: c.label,
        description: c.description ?? "",
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
            description: p?.description ?? "",
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

// Keep a valid selection when the filter results change.
$effect(() => {
  if (filtered.length === 0) {
    if (selectedLabel !== null) selectedLabel = null;
    return;
  }
  if (
    selectedLabel === null ||
    !filtered.some((d) => d.label === selectedLabel)
  ) {
    selectedLabel ??= filtered[0]?.label ?? null;
  }
});

let selectedDefinition = $derived(
  filtered.find((d) => d.label === selectedLabel) ?? null,
);

// ── Default diagram loading ─────────────────────────────────────────────────
// The selected definition's default diagram is the VFS file
// `diagrams/<label>.hcl`. Missing file → empty state (display-only).
let selectedLayout = $state<DiagramLayout>(emptyDiagramLayout());
let diagramExists = $state(false);

$effect(() => {
  const id = projectId;
  const label = selectedDefinition?.label;
  if (!id || !label) {
    selectedLayout = emptyDiagramLayout();
    diagramExists = false;
    return;
  }

  let cancelled = false;
  const path = defaultDiagramPath(label);
  const fs = openProjectFs(projectStore, id);
  // Probe existence first: `readDiagramLayoutFile` silently returns an
  // empty layout for ENOENT, but we must distinguish "empty diagram"
  // from "no default diagram file yet" (empty state).
  fs.readFile(path)
    .then(() => readDiagramLayoutFile(fs, path))
    .then((layout) => {
      if (cancelled) return;
      selectedLayout = layout;
      diagramExists = true;
    })
    .catch(() => {
      if (cancelled) return;
      selectedLayout = emptyDiagramLayout();
      diagramExists = false;
    });

  return () => {
    cancelled = true;
  };
});

// ── Preview rendering ───────────────────────────────────────────────────────
// Map layout component keys ("system/definition/…") to indices into the
// component arena (same convention as the Explore page).
const parentOf = $derived.by(() => {
  const map = new SvelteMap<number, number>();
  comps.forEach((c: RawComponent, index: number) => {
    if (c.parent?.Component !== undefined) map.set(index, c.parent.Component);
  });
  return map;
});
const rootSystemOf = $derived.by(() => {
  const map = new SvelteMap<number, string>();
  for (const sys of raw?.systems ?? []) {
    const walk = (cid: number) => {
      if (map.has(cid)) return;
      map.set(cid, sys.label);
      const c = comps[cid];
      for (const child of c?.children ?? []) walk(child);
    };
    for (const cid of sys.components ?? []) walk(cid);
  }
  return map;
});

function componentKey(index: number): string {
  const segs: string[] = [];
  let current: number | undefined = index;
  while (current !== undefined) {
    const c = comps[current];
    if (!c) return `#${index}`;
    segs.unshift(c.label);
    current = parentOf.get(current);
  }
  const root = rootSystemOf.get(index);
  if (root) segs.unshift(root);
  return segs.join("/");
}

let keyToIndex = $derived.by(() => {
  const map = new SvelteMap<string, number>();
  comps.forEach((_: RawComponent, index: number) => {
    map.set(componentKey(index), index);
  });
  return map;
});

let previewBoxes = $derived.by<Record<number, DiagramStaticBox>>(() => {
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

// The definition (or one of its placed instances) that the preview
// emphasizes, plus its whole subtree.
let staticComponents = $derived.by<DiagramStaticComponent[]>(() => {
  return comps.map((c: RawComponent) => ({
    label: c.label,
    icon: c.icon,
    color: c.color,
    border: c.border,
    font: c.font,
    parent_component_index: c.parent?.Component,
  }));
});

let staticConnections = $derived.by<DiagramStaticConnection[]>(() => {
  return rawConnections.map((c: RawConnection) => ({
    from: c.from.component,
    to: c.to.component,
    label: c.label,
  }));
});

let emptyStatePath = $derived(
  selectedDefinition ? defaultDiagramPath(selectedDefinition.label) : null,
);

let editHref = $derived(
  projectId && selectedDefinition
    ? resolve("/projects/[id]/diagrams", { id: projectId })
    : null,
);
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
      <div class="flex items-center gap-1" role="tablist" aria-label="Inventory filters">
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
      <div class="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 min-h-0">
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
              onselect={(label) => (selectedLabel = label)}
            />
          {/each}
        {/if}
      </div>
    </aside>

    <!-- Main column: diagram preview + detail pane -->
    <div class="flex flex-col flex-1 min-w-0 min-h-0">
      <div
        class="relative flex-1 min-h-0 bg-base-300 flex items-center justify-center overflow-hidden"
      >
        {#if selectedDefinition && diagramExists}
          <div class="w-full h-full">
            <DiagramStaticView
              components={staticComponents}
              connections={staticConnections}
              boxes={previewBoxes}
            />
          </div>
        {:else if selectedDefinition}
          <!-- Empty state: no default view diagram for this component -->
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
              </div>
            </div>
          </div>
        {:else}
          <div
            class="flex h-full w-full items-center justify-center text-sm text-base-content/60 p-4 text-center"
          >
            Select an entity to preview its default diagram.
          </div>
        {/if}
      </div>

      <DetailPane definition={selectedDefinition} {editHref} />
    </div>
  {/if}
</div>
