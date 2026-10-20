<script lang="ts">
  // Creation modal for a protocol: a label, an optional full name and a `leaf`
  // flag. The label is what ports and connections name the protocol by, so it
  // must be unique across protocols and contain no `/`. Chrome mirrors
  // CreateSystemModal; the fields are the protocol's own.
  interface Props {
    isOpen: boolean;
    /** Labels of the protocols already in the model. */
    existingLabels: readonly string[];
    oncreate: (data: {
      label: string;
      full_name: string;
      leaf: boolean;
    }) => void;
    onclose: () => void;
  }

  let { isOpen, existingLabels, oncreate, onclose }: Props = $props();

  let label = $state("");
  let fullName = $state("");
  let leaf = $state(false);

  $effect(() => {
    if (isOpen) {
      label = "";
      fullName = "";
      leaf = false;
    }
  });

  let trimmed = $derived(label.trim());
  let problem = $derived.by<string | null>(() => {
    if (trimmed === "") return null;
    if (trimmed.includes("/")) return "A protocol label cannot contain “/”.";
    if (existingLabels.includes(trimmed)) {
      return `A protocol named “${trimmed}” already exists.`;
    }
    return null;
  });
  let canCreate = $derived(trimmed !== "" && problem === null);

  function handleCreate() {
    if (!canCreate) return;
    oncreate({ label: trimmed, full_name: fullName.trim(), leaf });
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
    data-testid="create-protocol-modal"
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
          <span class="text-primary">+</span> Create New Protocol
        </h3>
        <button
          onclick={onclose}
          class="btn btn-sm btn-ghost btn-circle"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <div class="overflow-y-auto flex-1 py-4 pr-1 flex flex-col gap-3">
        <div class="form-control">
          <label class="label py-1" for="new-proto-name">
            <span
              class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70"
            >
              Label <span class="text-error">*</span>
            </span>
          </label>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            id="new-proto-name"
            type="text"
            bind:value={label}
            placeholder="e.g. uart, can, http"
            class="input input-sm input-bordered w-full font-medium"
            autofocus
            onkeydown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          {#if problem !== null}
            <p
              class="text-xs text-error mt-1"
              data-testid="create-protocol-problem"
            >
              {problem}
            </p>
          {/if}
        </div>

        <div class="form-control">
          <label class="label py-1" for="new-proto-full-name">
            <span
              class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70"
            >
              Full name
            </span>
          </label>
          <input
            id="new-proto-full-name"
            type="text"
            bind:value={fullName}
            placeholder="e.g. Universal asynchronous receiver-transmitter"
            class="input input-sm input-bordered w-full"
          />
        </div>

        <label class="label cursor-pointer justify-start gap-2 py-0">
          <input
            id="new-proto-leaf"
            type="checkbox"
            class="checkbox checkbox-sm"
            bind:checked={leaf}
          />
          <span class="label-text text-sm">
            Leaf: concrete enough to need no further realization
          </span>
        </label>
      </div>

      <div class="modal-action border-t border-base-300 pt-3 mt-0">
        <button onclick={onclose} class="btn btn-sm btn-ghost">Cancel</button>
        <button
          onclick={handleCreate}
          disabled={!canCreate}
          class="btn btn-sm btn-primary"
        >
          Create Protocol
        </button>
      </div>
    </div>
  </div>
{/if}
