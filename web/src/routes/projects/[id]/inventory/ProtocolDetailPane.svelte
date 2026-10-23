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
  // DetailPane does for components. The encapsulates search is reset too, so a
  // query typed for one protocol does not filter the next one's options.
  let lastLabel = $state<string | null>(null);
  $effect(() => {
    if (protocol.label !== lastLabel) {
      lastLabel = protocol.label;
      deleteConfirmText = "";
      carriesQuery = "";
      carriesListOpen = false;
      carriesActiveIndex = -1;
    }
  });

  // Blockers: every port that names the protocol and every protocol that lists
  // it in `encapsulates`. Both must be removed before the protocol can go.
  let blockerCount = $derived(usage.ports.length + usage.listedBy.length);

  // Protocols this one already carries. Duplicates are collapsed for display;
  // the model stays authoritative and every edit replaces the whole list.
  let carriedLabels = $derived([...new Set(protocol.encapsulates)]);

  // Protocols that can be added: every protocol except this one and the ones it
  // already carries.
  let addableProtocols = $derived(
    allProtocols.filter(
      (p) =>
        p.label !== protocol.label && !protocol.encapsulates.includes(p.label),
    ),
  );

  let carriesQuery = $state("");
  let carriesListOpen = $state(false);
  let carriesActiveIndex = $state(-1);

  let carriesOptions = $derived(
    addableProtocols.filter((p) =>
      p.label.toLowerCase().includes(carriesQuery.trim().toLowerCase()),
    ),
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

  // Add or remove one protocol from `encapsulates`. The update replaces the
  // whole list; a refusal leaves the model — and so the list — untouched and is
  // shown by the caller.
  async function addCarried(label: string): Promise<void> {
    const next = [
      ...protocol.encapsulates.filter((existing) => existing !== label),
      label,
    ];
    await onupdate({ encapsulates: next });
    carriesQuery = "";
    carriesListOpen = false;
    carriesActiveIndex = -1;
  }

  async function removeCarried(label: string): Promise<void> {
    const next = protocol.encapsulates.filter((existing) => existing !== label);
    await onupdate({ encapsulates: next });
  }

  function onCarriesKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (carriesOptions.length === 0) return;
      carriesListOpen = true;
      const step = event.key === "ArrowDown" ? 1 : carriesOptions.length - 1;
      carriesActiveIndex = (carriesActiveIndex + step) % carriesOptions.length;
      return;
    }
    if (event.key === "Enter" && carriesListOpen && carriesActiveIndex >= 0) {
      const option = carriesOptions[carriesActiveIndex];
      if (option !== undefined) {
        event.preventDefault();
        void addCarried(option.label);
      }
      return;
    }
    if (event.key === "Escape" && carriesListOpen) {
      event.preventDefault();
      event.stopPropagation();
      carriesListOpen = false;
      carriesActiveIndex = -1;
    }
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

        <fieldset
          class="flex flex-col gap-2"
          data-testid="protocol-encapsulates"
        >
          <legend class="text-xs font-semibold text-base-content/70 py-1">
            Can carry (encapsulates)
          </legend>
          <p class="text-xs text-base-content/50">
            Protocols this one can carry as payload.
          </p>

          {#if carriedLabels.length === 0}
            <p
              class="text-base-content/50 italic"
              data-testid="protocol-encapsulates-empty"
            >
              Carries no other protocols
            </p>
          {:else}
            <ul
              class="flex flex-col gap-1"
              data-testid="protocol-encapsulates-list"
            >
              {#each carriedLabels as label (label)}
                <li
                  class="flex items-center justify-between gap-2 rounded-box border border-base-300 bg-base-200 px-2 py-1"
                >
                  <span class="font-mono text-sm">{label}</span>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost btn-square text-error"
                    aria-label="Remove {label}"
                    title="Remove {label}"
                    onclick={() => void removeCarried(label)}
                  >
                    ✕
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <div class="form-control relative">
            <label class="label py-1" for="protocol-encapsulates-search">
              <span
                class="label-text text-xs font-semibold text-base-content/70"
              >
                Add a protocol
              </span>
            </label>
            <input
              id="protocol-encapsulates-search"
              type="text"
              role="combobox"
              aria-expanded={carriesListOpen}
              aria-controls="protocol-encapsulates-options"
              aria-autocomplete="list"
              aria-activedescendant={carriesActiveIndex >= 0
                ? `protocol-encapsulates-option-${String(carriesActiveIndex)}`
                : undefined}
              bind:value={carriesQuery}
              placeholder={addableProtocols.length === 0
                ? "No protocols left to add"
                : "Type to search protocols"}
              class="input input-sm input-bordered w-full"
              data-testid="protocol-encapsulates-search"
              autocomplete="off"
              disabled={addableProtocols.length === 0}
              oninput={() => {
                carriesListOpen = true;
                carriesActiveIndex = -1;
              }}
              onfocus={() => (carriesListOpen = true)}
              onblur={() => {
                carriesListOpen = false;
                carriesActiveIndex = -1;
              }}
              onkeydown={onCarriesKeydown}
            />
            {#if carriesListOpen && carriesOptions.length > 0}
              <ul
                id="protocol-encapsulates-options"
                role="listbox"
                class="menu menu-sm w-full bg-base-100 border border-base-300 rounded-box shadow-lg absolute top-full left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto flex-nowrap"
                data-testid="protocol-encapsulates-options"
              >
                {#each carriesOptions as option, index (option.label)}
                  <li
                    id="protocol-encapsulates-option-{index}"
                    role="option"
                    aria-selected={index === carriesActiveIndex}
                  >
                    <!-- mousedown, not click: the input must not blur first. -->
                    <button
                      type="button"
                      tabindex="-1"
                      class:menu-active={index === carriesActiveIndex}
                      data-testid="protocol-encapsulates-option"
                      onmousedown={(e) => {
                        e.preventDefault();
                        void addCarried(option.label);
                      }}
                    >
                      <span class="font-medium font-mono">{option.label}</span>
                      {#if option.full_name}
                        <span class="text-xs text-base-content/60"
                          >{option.full_name}</span
                        >
                      {/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {:else if carriesListOpen && carriesQuery.trim() !== "" && addableProtocols.length > 0}
              <p
                class="text-xs text-base-content/50 mt-1"
                data-testid="protocol-encapsulates-no-match"
              >
                No matching protocol.
              </p>
            {/if}
          </div>
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
