<script lang="ts">
import type { PortData } from "../../../../DocumentStore.svelte";
import NodeInspector from "./NodeInspector.svelte";

interface ParentOption {
  key: string;
  label: string;
  isSystem: boolean;
  path: string;
}

interface Props {
  isOpen: boolean;
  availableParents: ParentOption[];
  defaultParentKey?: string;
  initialPosition?: { x: number; y: number };
  oncreate: (data: {
    label: string;
    parentKey: string;
    description: string;
    tags: string[];
    leaf: boolean;
    ports: PortData[];
    position?: { x: number; y: number };
  }) => void;
  onclose: () => void;
}

let {
  isOpen,
  availableParents,
  defaultParentKey,
  initialPosition,
  oncreate,
  onclose,
}: Props = $props();

let label = $state("");
let selectedParentKey = $state("");
let parentSearch = $state("");
let parentDropdownOpen = $state(false);

let compDetails = $state({
  label: "",
  description: "",
  tags: [] as string[],
  leaf: true,
  ports: [] as PortData[],
  components: [],
  connections: [],
});

$effect(() => {
  if (isOpen) {
    label = "";
    selectedParentKey = defaultParentKey || (availableParents[0]?.key ?? "");
    parentSearch = "";
    parentDropdownOpen = false;
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
    (p) => p.label.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
  );
});

let selectedParentDisplay = $derived(
  availableParents.find((p) => p.key === selectedParentKey)?.path ??
    selectedParentKey,
);

function handleCreate() {
  const trimmed = label.trim();
  if (!trimmed) return;
  oncreate({
    label: trimmed,
    parentKey: selectedParentKey,
    description: compDetails.description,
    tags: compDetails.tags,
    leaf: compDetails.leaf,
    ports: compDetails.ports,
    position: initialPosition,
  });
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
      <div class="flex items-center justify-between pb-3 border-b border-base-300">
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

      <div class="overflow-y-auto flex-1 py-4 space-y-4 pr-1">
        <!-- 1. Component Name -->
        <div class="form-control">
          <label class="label py-1" for="new-comp-name">
            <span class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70">
              Component Name <span class="text-error">*</span>
            </span>
          </label>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            id="new-comp-name"
            type="text"
            bind:value={label}
            placeholder="e.g. flight-controller, sensor, battery"
            class="input input-sm input-bordered w-full font-medium"
            autofocus
            onkeydown={(e) => {
              if (e.key === "Enter" && label.trim()) {
                handleCreate();
              }
            }}
          />
        </div>

        <!-- 2. Searchable Parent Container Selector -->
        <div class="form-control relative">
          <label class="label py-1" for="new-comp-parent">
            <span class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70">
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

        <div class="divider my-1"></div>

        <!-- 3. Component Details & Ports / Messages / Fields (Reusing NodeInspector) -->
        <div class="bg-base-200/50 p-4 rounded-box border border-base-300">
          <h4 class="text-xs font-semibold uppercase tracking-wider text-base-content/70 mb-3">
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
            textAlign="center"
            onupdate={(patch) => {
              Object.assign(compDetails, patch);
            }}
            onrename={(newLabel) => {
              label = newLabel;
            }}
            onsettextalign={() => {}}
          />
        </div>
      </div>

      <div class="modal-action border-t border-base-300 pt-3 mt-0">
        <button onclick={onclose} class="btn btn-sm btn-ghost">Cancel</button>
        <button
          onclick={handleCreate}
          disabled={!label.trim() || !selectedParentKey}
          class="btn btn-sm btn-primary"
        >
          Create Component
        </button>
      </div>
    </div>
  </div>
{/if}
