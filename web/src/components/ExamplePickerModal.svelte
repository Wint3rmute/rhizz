<script lang="ts">
  import {
    type ExampleProject,
    get_example_projects,
  } from "../rhizome_wasm_wrapper";
  import { createExampleProject } from "./projectActions";

  // The bundled-examples picker, shared by the landing page ("Learn by
  // example") and the projects list ("New from example"). Picking a card
  // closes the modal and creates a project from that example.
  let { open = $bindable(false) }: { open?: boolean } = $props();

  // Read once the modal opens, not on mount: the list comes from the wasm
  // module, which pages render before anyone asks for examples.
  let examples = $derived<ExampleProject[]>(open ? get_example_projects() : []);

  function close() {
    open = false;
  }

  async function select(example: ExampleProject) {
    close();
    await createExampleProject(example);
  }
</script>

{#if open}
  <dialog class="modal modal-open">
    <div
      class="modal-box max-w-2xl bg-base-100 text-base-content border border-base-content/10 shadow-2xl"
    >
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-bold text-lg text-base-content">
          Choose an Example Architecture
        </h3>
        <button
          class="btn btn-sm btn-circle btn-ghost"
          onclick={close}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p class="text-sm text-base-content/70 mb-4">
        Select a template system from the bundled examples to initialize your
        new workspace.
      </p>

      <div
        class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto p-1"
      >
        {#each examples as example (example.id)}
          <button
            class="card bg-base-200 hover:bg-base-300 hover:border-primary/50 transition text-left p-4 cursor-pointer border border-base-content/10 flex flex-col justify-between"
            onclick={() => select(example)}
          >
            <div>
              <div class="flex items-start justify-between gap-2 mb-1">
                <div class="font-semibold text-base-content text-sm">
                  {example.name}
                </div>
                <span class="badge badge-xs badge-neutral shrink-0">
                  {example.files.length}
                  {example.files.length === 1 ? "file" : "files"}
                </span>
              </div>
              <div class="text-xs text-base-content/70 mt-1 line-clamp-3">
                {example.description}
              </div>
            </div>
          </button>
        {/each}
      </div>

      <div class="modal-action mt-4">
        <button class="btn btn-ghost btn-sm" onclick={close}>Cancel</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button onclick={close}>close</button>
    </form>
  </dialog>
{/if}
