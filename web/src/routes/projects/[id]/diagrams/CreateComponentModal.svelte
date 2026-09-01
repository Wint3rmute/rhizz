<script lang="ts">
import type { ComponentData, PortData } from "../../../../DocumentStore.svelte";
import type { TextAlign } from "./geometry";
import NodeInspector from "./NodeInspector.svelte";

interface ParentOption {
  key: string;
  label: string;
  isSystem: boolean;
  path: string;
}

/** A reusable component definition offered by "Use Existing Component". */
export interface ReusableDefinitionOption {
  /** The `source` label the instance will reference (the definition's identity). */
  sourceLabel: string;
  /** Human-readable label for the dropdown. */
  label: string;
  /** Optional icon name for rendering. */
  icon?: string | undefined;
}

interface Props {
  isOpen: boolean;
  availableParents: ParentOption[];
  /** Reusable definitions available for "Use Existing Component" mode. */
  reusableDefinitions: ReusableDefinitionOption[];
  defaultParentKey?: string | undefined;
  initialPosition?: { x: number; y: number } | undefined;
  oncreate: (data: {
    label: string;
    parentKey: string;
    description: string;
    tags: string[];
    leaf: boolean;
    ports: PortData[];
    sourceLabel?: string;
    textAlign?: TextAlign;
    position?: { x: number; y: number };
  }) => void;
  onclose: () => void;
}

let {
  isOpen,
  availableParents,
  reusableDefinitions,
  defaultParentKey,
  initialPosition,
  oncreate,
  onclose,
}: Props = $props();

/** "new" = define an inline body; "reuse" = source an existing definition. */
type Mode = "new" | "reuse";
let mode = $state<Mode>("new");

let label = $state("");
let selectedParentKey = $state("");
let parentSearch = $state("");
let parentDropdownOpen = $state(false);
let selectedSourceLabel = $state("");
let definitionSearch = $state("");
let definitionDropdownOpen = $state(false);
let textAlign = $state<TextAlign>("center");

let compDetails = $state<ComponentData>({
  label: "",
  description: "",
  tags: [],
  leaf: true,
  ports: [],
  components: [],
  connections: [],
});

$effect(() => {
  if (isOpen) {
    mode = "new";
    label = "";
    selectedParentKey = defaultParentKey || (availableParents[0]?.key ?? "");
    parentSearch = "";
    parentDropdownOpen = false;
    selectedSourceLabel = reusableDefinitions[0]?.sourceLabel ?? "";
    definitionSearch = "";
    definitionDropdownOpen = false;
    textAlign = "center";
    compDetails = {
      label: "",
      description: "",
      tags: [],
      leaf: true,
      ports: [],
      components: [],
      connections: [],
    };
  }
});

let filteredParents = $derived.by(() => {
  if (!parentSearch.trim()) return availableParents;
  const q = parentSearch.toLowerCase();
  return availableParents.filter(
    (p) =>
      p.label.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
  );
});

let selectedParentDisplay = $derived(
  availableParents.find((p) => p.key === selectedParentKey)?.path ??
    selectedParentKey,
);

let filteredDefinitions = $derived.by(() => {
  if (!definitionSearch.trim()) return reusableDefinitions;
  const q = definitionSearch.toLowerCase();
  return reusableDefinitions.filter(
    (d) =>
      d.sourceLabel.toLowerCase().includes(q) ||
      d.label.toLowerCase().includes(q),
  );
});

function handleCreate() {
  const trimmed = label.trim();
  if (!trimmed) return;
  const data: {
    label: string;
    parentKey: string;
    description: string;
    tags: string[];
    leaf: boolean;
    ports: PortData[];
    sourceLabel?: string;
    textAlign?: TextAlign;
    position?: { x: number; y: number };
  } = {
    label: trimmed,
    parentKey: selectedParentKey,
    description: compDetails.description ?? "",
    tags: compDetails.tags ?? [],
    leaf: compDetails.leaf,
    ports: compDetails.ports,
  };
  if (mode === "reuse") data.sourceLabel = selectedSourceLabel;
  if (textAlign !== undefined) data.textAlign = textAlign;
  if (initialPosition !== undefined) data.position = initialPosition;
  oncreate(data);
}
</script>

<svelte:window
  onkeydown={(e) => {
    if (isOpen && e.key === "Escape") onclose();
  }}
/>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
  class="modal modal-open z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center cursor-pointer"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onclick={(e) => {
      if (e.target === e.currentTarget) onclose();
    }}
>
  <div
    class="modal-box max-w-2xl bg-base-100 border border-base-300 shadow-2xl p-6 rounded-box max-h-[90vh] flex flex-col cursor-default"
  >
    <div
      class="flex items-center justify-between pb-3 border-b border-base-300">
      <h3 class="font-bold text-lg flex items-center gap-2">
          <span class="text-primary">+</span> Create New Component
        </h3>
      <button
        onclick={onclose}
        class="btn btn-sm btn-ghost btn-circle"
        title="Close (Esc)"
      >
          ✕
        </button>
    </div>

    <div class="py-3">
      <div class="join w-full">
        <button
          type="button"
          class="btn btn-sm join-item flex-1 {mode === 'new' ? 'btn-primary' : 'btn-ghost'}"
          onclick={() => (mode = "new")}
        >
          New Component Definition
        </button>
        <button
          type="button"
          class="btn btn-sm join-item flex-1 {mode === 'reuse' ? 'btn-primary' : 'btn-ghost'}"
          onclick={() => (mode = "reuse")}
          disabled={reusableDefinitions.length === 0}
          title={reusableDefinitions.length === 0
            ? "No reusable definitions yet — create one first"
            : ""}
        >
          Use Existing Component
        </button>
      </div>
      <p class="text-xs text-base-content/50 mt-2">
        {mode === "new"
          ? "Creates a top-level reusable definition (no system parent) that any system can reuse."
          : "Places an instance of an existing definition inside the chosen system/container."}
      </p>
    </div>

    <div class="overflow-y-auto flex-1 py-1 space-y-4 pr-1">
      <!-- 1. Component Name -->
      <div class="form-control">
        <label class="label py-1" for="new-comp-name">
          <span
            class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70">
              {mode === "new" ? "Definition Name" : "Instance Name"} <span class="text-error">*</span>
            </span>
        </label>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          id="new-comp-name"
          type="text"
          bind:value={label}
          placeholder={mode === "new"
            ? "e.g. flight-controller, sensor, battery"
            : "Local instance name"}
          class="input input-sm input-bordered w-full font-medium"
          autofocus
          onkeydown={(e) => {
              if (e.key === "Enter" && label.trim()) {
                handleCreate();
              }
            }}
        />
      </div>

      {#if mode === "reuse"}
      <!-- 2. Searchable Parent Container Selector (only for instances) -->
      <div class="form-control relative">
        <label class="label py-1" for="new-comp-parent">
          <span
            class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70">
              Parent System / Container <span class="text-error">*</span>
            </span>
        </label>

        <div class="relative">
            <button
              id="new-comp-parent"
              type="button"
              class="input input-sm input-bordered w-full text-left flex items-center justify-between font-mono text-xs"
              onclick={() => (parentDropdownOpen = !parentDropdownOpen)}
            >
              <span class="truncate">
                {selectedParentDisplay || "Select parent container..."}
              </span>
              <span class="text-base-content/50 ml-2">▾</span>
            </button>

            {#if parentDropdownOpen}
              <div
                class="absolute left-0 right-0 top-full mt-1 z-30 bg-base-100 border border-base-300 rounded-box shadow-xl p-2 space-y-2 max-h-48 flex flex-col"
              >
                <input
                  type="text"
                  bind:value={parentSearch}
                  placeholder="Search system or container..."
                  class="input input-xs input-bordered w-full"
                />
                <div class="overflow-y-auto flex-1 space-y-1">
                  {#if filteredParents.length === 0}
                    <div class="text-xs text-base-content/50 p-2 italic">
                      No matching containers found
                    </div>
                  {:else}
                    {#each filteredParents as parent (parent.key)}
                      <button
                        type="button"
                        class="w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 cursor-pointer {selectedParentKey ===
                        parent.key
                          ? 'bg-primary/10 text-primary font-semibold'
                          : ''}"
                        onclick={() => {
                          selectedParentKey = parent.key;
                          parentDropdownOpen = false;
                        }}
                      >
                        <span class="truncate font-mono">{parent.path}</span>
                        <span
                          class="badge badge-xs {parent.isSystem
                            ? 'badge-primary'
                            : 'badge-ghost'}"
                        >
                          {parent.isSystem ? "System" : "Component"}
                        </span>
                      </button>
                    {/each}
                  {/if}
                </div>
              </div>
            {/if}
          </div>
      </div>
      {/if}

      {#if mode === "reuse"}
        <!-- Definition picker: pick which reusable definition to source -->
        <div class="form-control relative">
          <label class="label py-1" for="reuse-definition">
            <span
              class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70">
                Reusable Definition <span class="text-error">*</span>
              </span>
          </label>
          <div class="relative">
            <button
              id="reuse-definition"
              type="button"
              class="input input-sm input-bordered w-full text-left flex items-center justify-between font-mono text-xs"
              onclick={() => (definitionDropdownOpen = !definitionDropdownOpen)}
            >
              <span class="truncate">
                {reusableDefinitions.find((d) => d.sourceLabel === selectedSourceLabel)
                  ?.label ?? "Select a definition..."}
              </span>
              <span class="text-base-content/50 ml-2">▾</span>
            </button>
            {#if definitionDropdownOpen}
              <div
                class="absolute left-0 right-0 top-full mt-1 z-30 bg-base-100 border border-base-300 rounded-box shadow-xl p-2 space-y-2 max-h-48 flex flex-col"
              >
                <input
                  type="text"
                  bind:value={definitionSearch}
                  placeholder="Search definitions..."
                  class="input input-xs input-bordered w-full"
                />
                <div class="overflow-y-auto flex-1 space-y-1">
                  {#if filteredDefinitions.length === 0}
                    <div class="text-xs text-base-content/50 p-2 italic">
                      No matching definitions found
                    </div>
                  {:else}
                    {#each filteredDefinitions as def (def.sourceLabel)}
                      <button
                        type="button"
                        class="w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 cursor-pointer {selectedSourceLabel ===
                        def.sourceLabel
                          ? 'bg-primary/10 text-primary font-semibold'
                          : ''}"
                        onclick={() => {
                          selectedSourceLabel = def.sourceLabel;
                          definitionDropdownOpen = false;
                        }}
                      >
                        <span class="truncate font-mono">{def.label}</span>
                      </button>
                    {/each}
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </div>

        <div class="divider my-1"></div>
      {/if}

      <!-- 3. Component Details & Ports / Messages / Fields (Reusing NodeInspector) -->
      {#if mode === "new"}
        <div class="bg-base-200/50 p-4 rounded-box border border-base-300">
          <h4
            class="text-xs font-semibold uppercase tracking-wider text-base-content/70 mb-3">
            Component Properties & Ports
          </h4>
          <NodeInspector
            componentKey={selectedParentKey
                ? `${selectedParentKey}/${label || "untitled"}`
                : label || "untitled"}
            component={{
                ...compDetails,
                label: label || "untitled",
              }}
            {textAlign}
            onupdate={(patch) => {
                Object.assign(compDetails, patch);
              }}
            onrename={(newLabel) => {
                label = newLabel;
              }}
            onsettextalign={(align) => {
                textAlign = align;
              }}
          />
        </div>
      {:else}
        <p class="text-xs text-base-content/60">
          The selected definition's body (including any children, ports, and
          internal connections) is reused as-is. This instance references it via
          <code class="font-mono">source</code>.
        </p>
      {/if}
    </div>

    <div class="modal-action border-t border-base-300 pt-3 mt-0">
      <button onclick={onclose} class="btn btn-sm btn-ghost">Cancel</button>
      <button
        onclick={handleCreate}
        disabled={!label.trim() || (mode === "reuse" && !selectedParentKey)}
        class="btn btn-sm btn-primary"
      >
          Create {mode === "new" ? "Definition" : "Instance"}
        </button>
    </div>
  </div>
</div>
{/if}
