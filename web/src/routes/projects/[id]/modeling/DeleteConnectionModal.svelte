<script lang="ts">
  // "Delete connection" dialog. Replaces the browser confirm prompt and adds
  // the destructive opt-in: remove the endpoint ports too. Ports live on
  // component definitions, so the dialog lists the ports it would remove and
  // the ones another connection still uses.
  //
  // The decision data comes from `deleteConnection.ts`; the Rust dispatcher
  // performs the deletion as one atomic op. Ports another connection still
  // uses are kept while the selected unshared ports are removed.
  import type { DeleteConnectionRequest } from "./deleteConnection";

  interface Props {
    /** What is being deleted; `null` keeps the dialog closed. */
    request: DeleteConnectionRequest | null;
    /** Runs the op with the selected `definition/port` entries to remove. */
    onconfirm: (ports: string[]) => void | Promise<void>;
    onclose: () => void;
  }

  let { request, onconfirm, onclose }: Props = $props();

  function portKey(definition: string, port: string): string {
    return `${definition}/${port}`;
  }

  // Selected `definition/port` entries to remove. Unchecked by default:
  // removing ports is the destructive choice. Kept ports cannot be selected.
  let selected: string[] = $state([]);
  let submitting = $state(false);

  $effect(() => {
    if (request !== null) selected = [];
  });

  function toggleAll(checked: boolean): void {
    if (request === null) return;
    selected = checked
      ? request.removablePorts.map((port) => portKey(port.definition, port.port))
      : [];
  }

  function toggleOne(key: string, checked: boolean): void {
    selected = checked
      ? [...selected, key]
      : selected.filter((entry) => entry !== key);
  }

  let allChecked = $derived(
    request !== null &&
      request.removablePorts.length > 0 &&
      request.removablePorts.every((port) =>
        selected.includes(portKey(port.definition, port.port)),
      ),
  );

  // Human-readable summary for the partial cleanup: which selected ports go,
  // and which shared ports stay.
  let keptSummary = $derived(
    request === null
      ? ""
      : request.keptPorts
          .map(
            (port) =>
              `\`${port.port}\` (also used by connection \`${port.usedBy.join(", ")}\`)`,
          )
          .join(", "),
  );

  let selectedSummary = $derived(
    request === null
      ? ""
      : request.removablePorts
          .filter((port) =>
            selected.includes(portKey(port.definition, port.port)),
          )
          .map((port) => `\`${port.port}\``)
          .join(", "),
  );

  async function submit(): Promise<void> {
    if (request === null || submitting) return;
    submitting = true;
    try {
      await onconfirm([...selected]);
    } finally {
      submitting = false;
    }
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (request === null) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onclose();
      return;
    }
    // Delete/Enter confirm, keeping the old prompt's keyboard behavior.
    if (event.key === "Delete" || event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if request !== null}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="modal modal-open z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center cursor-pointer"
    role="dialog"
    aria-modal="true"
    aria-label="Delete connection"
    data-testid="delete-connection-modal"
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
          <span class="text-error">🗑</span> Delete connection
        </h3>
        <button
          onclick={onclose}
          class="btn btn-sm btn-ghost btn-circle"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <div class="overflow-y-auto flex-1 py-4 pr-1 flex flex-col gap-4">
        <p class="text-sm">
          Delete connection
          <code
            class="font-mono font-semibold"
            data-testid="delete-connection-label">{request.label}</code
          >
          from the system model?
        </p>

        <div
          class="rounded-box border border-base-300 bg-base-200/40 p-3 flex items-center gap-3"
          data-testid="delete-connection-endpoints"
        >
          <div class="flex-1 min-w-0 text-center">
            <div class="text-xs uppercase tracking-wider text-base-content/60">
              From
            </div>
            <div
              class="font-semibold truncate"
              data-testid="delete-connection-from"
            >
              {request.from.component}
            </div>
            {#if request.from.port !== undefined}
              <code class="text-xs text-base-content/70"
                >{request.from.port}</code
              >
            {/if}
          </div>
          <div class="text-primary" aria-hidden="true">→</div>
          <div class="flex-1 min-w-0 text-center">
            <div class="text-xs uppercase tracking-wider text-base-content/60">
              To
            </div>
            <div
              class="font-semibold truncate"
              data-testid="delete-connection-to"
            >
              {request.to.component}
            </div>
            {#if request.to.port !== undefined}
              <code class="text-xs text-base-content/70">{request.to.port}</code
              >
            {/if}
          </div>
        </div>

        <label
          class="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 p-3"
        >
          <input
            type="checkbox"
            class="checkbox checkbox-sm checkbox-error"
            checked={allChecked}
            onchange={(e) => toggleAll(e.currentTarget.checked)}
            data-testid="delete-connection-remove-ports"
            disabled={request.removablePorts.length === 0}
          />
          <span class="label-text">
            Also remove ports on connected components
            <span class="block text-xs text-base-content/60">
              Ports live on component definitions, so every instance of a
              definition loses them. Tick individual ports below to select
              which ones go.
            </span>
          </span>
        </label>

        <div data-testid="delete-connection-ports">
          <h4
            class="font-semibold text-xs uppercase tracking-wider text-base-content/70 mb-2"
          >
            Endpoint ports
          </h4>
          {#if request.removablePorts.length === 0 && request.keptPorts.length === 0}
            <p class="text-sm text-base-content/60">
              Endpoint ports could not be resolved for this connection.
            </p>
          {:else}
            <ul class="space-y-1 text-sm">
              {#each request.removablePorts as port (port.definition + "/" + port.port)}
                {@const key = portKey(port.definition, port.port)}
                {@const checked = selected.includes(key)}
                <li
                  class="flex items-center gap-2"
                  data-testid="delete-connection-port"
                >
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs checkbox-error"
                    checked={checked}
                    onchange={(e) => toggleOne(key, e.currentTarget.checked)}
                    data-testid="delete-connection-port-checkbox"
                    aria-label={`Remove port ${port.port} on ${port.definition}`}
                  />
                  <code class="font-mono">{port.port}</code>
                  <span class="text-base-content/70">on {port.definition}</span>
                  <span
                    class="badge badge-sm {checked
                      ? 'badge-error'
                      : 'badge-ghost'} ml-auto"
                  >
                    {checked ? "Will be removed" : "Keep"}
                  </span>
                </li>
              {/each}
              {#each request.keptPorts as port (port.definition + "/" + port.port)}
                <li
                  class="flex items-center gap-2"
                  data-testid="delete-connection-kept-port"
                >
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs"
                    disabled
                    checked={false}
                    aria-label={`Port ${port.port} on ${port.definition} is used elsewhere`}
                  />
                  <code class="font-mono">{port.port}</code>
                  <span class="text-base-content/70">on {port.definition}</span>
                  <span class="badge badge-sm badge-warning ml-auto">
                    Used by {port.usedBy.join(", ")}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        {#if selected.length > 0 && request.keptPorts.length > 0}
          <div
            class="alert alert-info text-sm"
            data-testid="delete-connection-port-conflict"
          >
            Only {selectedSummary} will be removed, as {keptSummary} is also used
            by another connection.
          </div>
        {/if}
      </div>

      <div class="modal-action border-t border-base-300 pt-3 mt-0">
        <button onclick={onclose} class="btn btn-sm btn-ghost">Cancel</button>
        <button
          onclick={() => void submit()}
          disabled={submitting}
          class="btn btn-sm btn-error"
          data-testid="delete-connection-confirm"
        >
          Delete connection
        </button>
      </div>
    </div>
  </div>
{/if}
