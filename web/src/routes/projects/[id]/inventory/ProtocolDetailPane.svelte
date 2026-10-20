<script lang="ts">
  // Detail pane for the selected protocol. Fills the right `Pane` of the
  // Inventory workspace, like DetailPane does for components. Overview edits
  // the protocol in the system model and reports a refusal back, so the caller
  // can show it. Messages and Usage are read-only. Delete mirrors DetailPane's
  // type-to-confirm gate, with the usages as blockers.
  import type { ProtocolPatch } from "../../../../actionLog";
  import type {
    ProtocolData,
    ProtocolMessageData,
    ProtocolUsage,
  } from "../../../../modelView";
  import { inventoryEntityHref, inventoryProtocolHref } from "./protocolLink";

  let {
    projectId,
    protocol,
    allProtocols,
    messages,
    usage,
    onupdate,
    ondelete,
  }: {
    projectId: string | null;
    protocol: ProtocolData;
    /** Every protocol in the model, for the `encapsulates` checkboxes. */
    allProtocols: readonly ProtocolData[];
    messages: readonly ProtocolMessageData[];
    usage: ProtocolUsage;
    /**
     * Apply a protocol edit. Resolves to `true` when the model accepted it, and
     * `false` when it refused it (the refusal is shown by the caller).
     */
    onupdate: (patch: ProtocolPatch) => Promise<boolean>;
    ondelete: () => Promise<void>;
  } = $props();

  type Tab = "Overview" | "Messages" | "Usage" | "Delete";
  const TABS: readonly Tab[] = ["Overview", "Messages", "Usage", "Delete"];

  let activeTab = $state<Tab>("Overview");
  let deleteConfirmText = $state("");
  let deletingProtocol = $state(false);

  // Reset the per-protocol delete confirmation when the open protocol changes,
  // so a half-typed label does not carry over. The tab itself is kept, like
  // DetailPane does for components.
  let lastLabel = $state<string | null>(null);
  $effect(() => {
    if (protocol.label !== lastLabel) {
      lastLabel = protocol.label;
      deleteConfirmText = "";
    }
  });

  // Blockers: every port that names the protocol and every protocol that lists
  // it in `encapsulates`. Both must be removed before the protocol can go.
  let blockerCount = $derived(usage.ports.length + usage.listedBy.length);

  let otherProtocols = $derived(
    allProtocols.filter((p) => p.label !== protocol.label),
  );

  function parseList(text: string): string[] {
    return text
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }

  // Each commit sends one op. A refusal leaves the model untouched, so the
  // control is put back to the model's value instead of showing an edit that
  // was never written.
  async function commitFullName(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const applied = await onupdate({ full_name: input.value.trim() });
    if (!applied) input.value = protocol.full_name;
  }

  async function commitTags(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const applied = await onupdate({ tags: parseList(input.value) });
    if (!applied) input.value = protocol.tags.join(", ");
  }

  async function commitRoles(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const applied = await onupdate({ roles: parseList(input.value) });
    if (!applied) input.value = protocol.roles.join(", ");
  }

  async function commitLeaf(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const applied = await onupdate({ leaf: input.checked });
    if (!applied) input.checked = protocol.leaf;
  }

  async function commitCarries(event: Event, label: string): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const next = input.checked
      ? [...protocol.encapsulates.filter((l) => l !== label), label]
      : protocol.encapsulates.filter((l) => l !== label);
    const applied = await onupdate({ encapsulates: next });
    if (!applied) input.checked = protocol.encapsulates.includes(label);
  }

  function connectionLabel(ref: { scopePath: string; label: string }): string {
    return ref.scopePath === "" ? ref.label : `${ref.scopePath} › ${ref.label}`;
  }
</script>

<div
  class="bg-base-100 flex flex-col flex-1 min-h-[180px] md:min-h-0 w-full min-w-0"
  data-testid="protocol-detail-pane"
>
  <div class="px-4 pt-3">
    <h2 class="font-mono font-semibold text-base truncate">{protocol.label}</h2>
    {#if protocol.full_name}
      <p class="text-xs text-base-content/60">{protocol.full_name}</p>
    {/if}
  </div>

  <div
    class="mt-2 flex items-center border-b border-base-300 px-2 overflow-x-auto"
    role="tablist"
    aria-label="Protocol details"
  >
    {#each TABS as tab (tab)}
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === tab}
        class="px-2 py-2 text-xs border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 {activeTab ===
        tab
          ? tab === 'Delete'
            ? 'border-error text-error font-medium'
            : 'border-primary text-primary font-medium'
          : tab === 'Delete'
            ? 'border-transparent text-error/60 hover:text-error'
            : 'border-transparent text-base-content/60 hover:text-base-content'}"
        onclick={() => (activeTab = tab)}
      >
        {tab}
      </button>
    {/each}
  </div>

  <div class="flex-1 min-h-0 overflow-auto p-4 text-sm flex flex-col gap-4">
    {#if activeTab === "Overview"}
      <div class="flex flex-col gap-3" data-testid="protocol-overview">
        <label class="form-control">
          <span
            class="label-text text-xs font-semibold text-base-content/70 py-1"
          >
            Full name
          </span>
          <input
            type="text"
            class="input input-sm input-bordered w-full"
            value={protocol.full_name}
            onchange={(e) => void commitFullName(e)}
          />
        </label>

        <label class="form-control">
          <span
            class="label-text text-xs font-semibold text-base-content/70 py-1"
          >
            Tags <span class="font-normal">(comma-separated)</span>
          </span>
          <input
            type="text"
            class="input input-sm input-bordered w-full"
            value={protocol.tags.join(", ")}
            onchange={(e) => void commitTags(e)}
          />
        </label>

        <label class="form-control">
          <span
            class="label-text text-xs font-semibold text-base-content/70 py-1"
          >
            Roles <span class="font-normal">(empty allows any role)</span>
          </span>
          <input
            type="text"
            class="input input-sm input-bordered w-full"
            value={protocol.roles.join(", ")}
            onchange={(e) => void commitRoles(e)}
          />
        </label>

        <label class="label cursor-pointer justify-start gap-2 py-0">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            checked={protocol.leaf}
            onchange={(e) => void commitLeaf(e)}
          />
          <span class="label-text text-sm">
            Leaf: concrete enough to need no further realization
          </span>
        </label>

        <fieldset class="flex flex-col gap-1">
          <legend class="text-xs font-semibold text-base-content/70 py-1">
            Can carry (encapsulates)
          </legend>
          <p class="text-xs text-base-content/50">
            Protocols this one can carry as payload.
          </p>
          {#if otherProtocols.length === 0}
            <p class="text-base-content/50 italic">
              No other protocols to carry yet.
            </p>
          {/if}
          {#each otherProtocols as other (other.label)}
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={protocol.encapsulates.includes(other.label)}
                onchange={(e) => void commitCarries(e, other.label)}
              />
              <span class="label-text font-mono text-sm">{other.label}</span>
            </label>
          {/each}
        </fieldset>
      </div>
    {:else if activeTab === "Messages"}
      <div data-testid="protocol-messages">
        {#if messages.length === 0}
          <p class="text-base-content/50 italic">
            This protocol declares no messages.
          </p>
        {:else}
          {#each messages as message (message.label)}
            <div class="mb-3">
              <p class="font-semibold font-mono">{message.label}</p>
              {#if message.fields.length === 0}
                <p class="text-xs text-base-content/50 italic">No fields.</p>
              {:else}
                <table class="table table-xs">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Type</th>
                      <th>Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each message.fields as field (field.label)}
                      <tr>
                        <td class="font-mono">{field.label}</td>
                        <td class="font-mono">{field.type || "—"}</td>
                        <td>{field.required ? "yes" : "no"}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {:else if activeTab === "Usage"}
      <div class="flex flex-col gap-4" data-testid="protocol-usage">
        <section>
          <h3
            class="text-xs font-semibold uppercase tracking-wider text-base-content/70 mb-1"
          >
            Ports using it
          </h3>
          {#if usage.ports.length === 0}
            <p class="text-base-content/50 italic">
              No port uses this protocol.
            </p>
          {:else}
            <ul class="flex flex-col gap-1">
              {#each usage.ports as port (`${port.componentKey}/${port.portLabel}`)}
                <li>
                  <a
                    class="link link-hover font-mono"
                    href={inventoryEntityHref(projectId, port.componentLabel)}
                  >
                    {port.componentLabel} · {port.portLabel}
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section>
          <h3
            class="text-xs font-semibold uppercase tracking-wider text-base-content/70 mb-1"
          >
            Protocols that can carry it
          </h3>
          {#if usage.listedBy.length === 0}
            <p class="text-base-content/50 italic">
              No protocol lists it in encapsulates.
            </p>
          {:else}
            <ul class="flex flex-col gap-1">
              {#each usage.listedBy as label (label)}
                <li>
                  <a
                    class="link link-hover font-mono"
                    href={inventoryProtocolHref(projectId, label)}
                  >
                    {label}
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section>
          <h3
            class="text-xs font-semibold uppercase tracking-wider text-base-content/70 mb-1"
          >
            Connections it types
          </h3>
          {#if usage.connections.length === 0}
            <p class="text-base-content/50 italic">
              No connection is typed by it.
            </p>
          {:else}
            <ul class="flex flex-col gap-1 font-mono">
              {#each usage.connections as ref (`${ref.scopePath}/${ref.label}`)}
                <li>{connectionLabel(ref)}</li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>
    {:else if activeTab === "Delete"}
      <!-- Same shape as the component Delete tab: the form is always shown and
           the blockers only disable it, so the reason sits next to the button. -->
      <div class="flex flex-col gap-3" data-testid="protocol-delete-tab">
        <p
          class="text-sm font-medium rounded-box border border-error/40 bg-error/10 px-3 py-2 text-error"
        >
          Delete <code class="font-mono">{protocol.label}</code> from the system model?
          This cannot be undone.
        </p>
        <div class="form-control">
          <label class="label py-1" for="protocol-delete-confirm-input">
            <span
              class="label-text text-xs font-semibold tracking-wider text-base-content/70"
            >
              Type "{protocol.label}" to confirm
            </span>
          </label>
          <input
            id="protocol-delete-confirm-input"
            type="text"
            bind:value={deleteConfirmText}
            class="input input-sm input-bordered w-full font-mono"
            autocomplete="off"
            disabled={blockerCount > 0}
          />
        </div>
        <button
          type="button"
          class="btn btn-sm btn-error"
          data-testid="protocol-delete-confirm"
          disabled={blockerCount > 0 ||
            deleteConfirmText !== protocol.label ||
            deletingProtocol}
          onclick={() => {
            deletingProtocol = true;
            void ondelete().finally(() => {
              deletingProtocol = false;
            });
          }}
        >
          {deletingProtocol ? "Deleting…" : "Confirm deletion"}
        </button>
        {#if blockerCount > 0}
          <div
            class="rounded-box border border-warning/40 bg-warning/10 px-3 py-2"
            data-testid="inventory-delete-blockers"
          >
            <p
              class="text-xs font-semibold uppercase tracking-wider text-warning"
            >
              Still used — remove these first
            </p>
            <ul class="mt-1 text-sm">
              {#each usage.ports as port (`${port.componentKey}/${port.portLabel}`)}
                <li class="flex items-center gap-2 min-w-0 py-0.5">
                  <span
                    class="shrink-0 w-4 text-center text-warning"
                    aria-hidden="true">⚠</span
                  >
                  <a
                    class="link link-hover truncate min-w-0 font-mono"
                    href={inventoryEntityHref(projectId, port.componentLabel)}
                  >
                    {port.componentLabel} · {port.portLabel}
                  </a>
                </li>
              {/each}
              {#each usage.listedBy as label (label)}
                <li class="flex items-center gap-2 min-w-0 py-0.5">
                  <span
                    class="shrink-0 w-4 text-center text-warning"
                    aria-hidden="true">⚠</span
                  >
                  <a
                    class="link link-hover truncate min-w-0 font-mono"
                    href={inventoryProtocolHref(projectId, label)}
                  >
                    {label} lists it in encapsulates
                  </a>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
