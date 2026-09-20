<script lang="ts">
// Modal for creating a new diagram view, mirroring CreateComponentModal's
// shell (backdrop, Esc/backdrop close, modal-box layout) but much smaller:
// a view name input plus a system select. Replaces the two chained native
// prompt() calls the Diagrams tree used to show in a row.
//
// The view→system binding is immutable after creation, so picking the
// system here is the only UI chance to set it (delete + recreate, or
// hand-edit in Code, to re-bind later).
interface Props {
  isOpen: boolean;
  /** System labels available for binding, in model order. */
  systems: { label: string }[];
  /** Pre-selected system when the modal opens. */
  defaultSystem?: string | undefined;
  oncreate: (data: { name: string; system: string }) => void;
  onclose: () => void;
}

let { isOpen, systems, defaultSystem, oncreate, onclose }: Props = $props();

let name = $state("");
let selectedSystem = $state("");
let nameError = $state<string | null>(null);

$effect(() => {
  if (isOpen) {
    name = "";
    nameError = null;
    selectedSystem = defaultSystem || systems[0]?.label || "main";
  }
});

function validateName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "Enter a view name.";
  if (trimmed.includes("/")) {
    return "Name can't contain slashes — use + Folder for nesting.";
  }
  return null;
}

function handleCreate() {
  const error = validateName(name);
  nameError = error;
  if (error) return;
  let finalName = name.trim();
  if (!finalName.endsWith(".hcl")) finalName += ".hcl";
  if (!selectedSystem) return;
  oncreate({ name: finalName, system: selectedSystem });
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
  data-testid="new-view-modal"
  tabindex="-1"
  onclick={(e) => {
      if (e.target === e.currentTarget) onclose();
    }}
>
  <div
    class="modal-box max-w-md bg-base-100 border border-base-300 shadow-2xl p-6 rounded-box flex flex-col cursor-default"
  >
    <div
      class="flex items-center justify-between pb-3 border-b border-base-300">
      <h3 class="font-bold text-lg flex items-center gap-2">
          <span class="text-primary">+</span> Create New View
        </h3>
      <button
        onclick={onclose}
        class="btn btn-sm btn-ghost btn-circle"
        title="Close (Esc)"
      >
          ✕
        </button>
    </div>

    <div class="py-4 space-y-4">
      <div class="form-control">
          <label class="label py-1" for="new-view-name">
            <span
              class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70"
            >
              View Name <span class="text-error">*</span>
            </span>
          </label>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            id="new-view-name"
            type="text"
            bind:value={name}
            placeholder="e.g. overview.hcl"
            class="input input-sm input-bordered w-full font-medium"
            autofocus
            onkeydown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          {#if nameError}
            <span class="text-error text-xs mt-1">{nameError}</span>
          {/if}
        </div>

      <div class="form-control">
          <label class="label py-1" for="new-view-system">
            <span
              class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70"
            >
              System <span class="text-error">*</span>
            </span>
          </label>
          {#if systems.length === 0}
            <input
              id="new-view-system"
              type="text"
              value="main"
              disabled
              class="input input-sm input-bordered w-full font-mono text-xs"
            />
            <p class="text-xs text-base-content/50 mt-1">
              No systems yet — the view will bind to a new "main" system.
            </p>
          {:else}
            <select
              id="new-view-system"
              bind:value={selectedSystem}
              class="select select-sm select-bordered w-full font-mono text-xs"
            >
              {#each systems as system (system.label)}
                <option value={system.label}>{system.label}</option>
              {/each}
            </select>
            <p class="text-xs text-base-content/50 mt-1">
              Immutable after creation — delete and recreate to re-bind.
            </p>
          {/if}
        </div>
    </div>

    <div class="modal-action border-t border-base-300 pt-3 mt-0">
      <button onclick={onclose} class="btn btn-sm btn-ghost">Cancel</button>
      <button
        onclick={handleCreate}
        disabled={!name.trim() || !selectedSystem}
        class="btn btn-sm btn-primary"
      >
          Create View
        </button>
    </div>
  </div>
</div>
{/if}
