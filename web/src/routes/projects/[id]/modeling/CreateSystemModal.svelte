<script lang="ts">
// Creation modal for a top-level system: a name and nothing else. Systems
// carry no ports, children or visual attributes in the schema, so there is
// no inspector to show — this mirrors CreateComponentModal's chrome
// (backdrop, header, autofocused name field, Cancel/Create) in a
// single-field form.
interface Props {
  isOpen: boolean;
  oncreate: (label: string) => void;
  onclose: () => void;
}

let { isOpen, oncreate, onclose }: Props = $props();

let label = $state("");

$effect(() => {
  if (isOpen) label = "";
});

function handleCreate() {
  const trimmed = label.trim();
  if (!trimmed) return;
  oncreate(trimmed);
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
  data-testid="create-system-modal"
  tabindex="-1"
  onclick={(e) => {
      if (e.target === e.currentTarget) onclose();
    }}
>
  <div
    class="modal-box max-w-lg bg-base-100 border border-base-300 shadow-2xl p-6 rounded-box max-h-[90vh] flex flex-col cursor-default"
  >
    <div
      class="flex items-center justify-between pb-3 border-b border-base-300"
    >
      <h3 class="font-bold text-lg flex items-center gap-2">
          <span class="text-primary">+</span> Create New System
        </h3>
      <button
        onclick={onclose}
        class="btn btn-sm btn-ghost btn-circle"
        title="Close (Esc)"
      >
          ✕
        </button>
    </div>

    <div class="overflow-y-auto flex-1 py-4 pr-1">
      <div class="form-control">
        <label class="label py-1" for="new-sys-name">
          <span
            class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70"
          >
              System Name <span class="text-error">*</span>
            </span>
        </label>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          id="new-sys-name"
          type="text"
          bind:value={label}
          placeholder="e.g. quadcopter, ground-control"
          class="input input-sm input-bordered w-full font-medium"
          autofocus
          onkeydown={(e) => {
              if (e.key === "Enter" && label.trim()) {
                handleCreate();
              }
            }}
        />
      </div>
    </div>

    <div class="modal-action border-t border-base-300 pt-3 mt-0">
      <button onclick={onclose} class="btn btn-sm btn-ghost">Cancel</button>
      <button
        onclick={handleCreate}
        disabled={!label.trim()}
        class="btn btn-sm btn-primary"
      >
          Create System
        </button>
    </div>
  </div>
</div>
{/if}
