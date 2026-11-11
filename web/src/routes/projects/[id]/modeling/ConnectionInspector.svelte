<script lang="ts">
  import type { ConnectionPatch, ConnectionRef } from "../../../../actionLog";
  import {
    connectionByRef,
    connectionRefKey,
    type ConnectionData,
    type PortData,
    type ProtocolData,
  } from "../../../../modelView";
  import { inventoryProtocolHref } from "../inventory/protocolLink";
  import { resolveIcon } from "../../../../iconHelper";

  interface Props {
    /** The project the inspector belongs to, for the protocol deep link. */
    projectId: string | null;
    /** The connection being inspected. */
    connection: ConnectionData;
    /** Every connection in the model, to resolve realization targets. */
    connections: readonly ConnectionData[];
    /** Labels of the components at each end. */
    fromLabel: string;
    toLabel: string;
    /** FontAwesome icon names of the endpoint components, drawn before the labels. */
    fromIcon?: string | undefined;
    toIcon?: string | undefined;
    /** Ports declared on the from/to endpoint component instances. */
    fromPorts: readonly PortData[];
    toPorts: readonly PortData[];
    /**
     * Labels of those ports that a connection in the model ends on. Per placed
     * instance: two instances of one definition can differ.
     */
    fromConnectedPorts: ReadonlySet<string>;
    toConnectedPorts: ReadonlySet<string>;
    /**
     * True when the connection lives in a reusable component, so an edit also
     * reaches every copy of it in the instances.
     */
    sharedWithCopies: boolean;
    /** The protocol both endpoints share, when there is one. */
    protocol: ProtocolData | undefined;
    /** Why there is no protocol, shown in place of the protocol fields. */
    protocolReason: string | undefined;
    /** How many other connections and ports use the protocol. */
    protocolUsage: { connections: number; ports: number } | undefined;
    /** Labels of the connections placed in the open view. */
    placedLabels: readonly string[];
    onupdate: (patch: ConnectionPatch) => void;
    /** Selects a connection on the canvas. */
    onselect: (ref: ConnectionRef) => void;
    ondelete: () => void;
    /**
     * Disables every mutating control (inputs, realization add/remove,
     * delete) but leaves navigation live: the "Show" row buttons and the
     * "Edit protocol" link keep working.
     */
    readonly?: boolean;
  }

  // Which file each panel's attributes are written to, named the way the user
  // would: the model file. The inspector does not know which view is open.
  const SCOPE_FILE = { model: "system.hcl" };

  let {
    projectId,
    connection,
    connections,
    fromLabel,
    toLabel,
    fromIcon = undefined,
    toIcon = undefined,
    fromPorts,
    toPorts,
    fromConnectedPorts,
    toConnectedPorts,
    sharedWithCopies,
    protocol,
    protocolReason,
    protocolUsage,
    placedLabels,
    onupdate,
    onselect,
    ondelete,
    readonly = false,
  }: Props = $props();

  // Editable fields mirror the model until committed. Committing on blur keeps
  // one undo step per edit, and an unchanged value writes nothing.
  let editFullName = $state("");
  let editTags = $state("");
  let editLevel = $state(0);

  $effect(() => {
    editFullName = connection.full_name;
    editTags = connection.tags.join(", ");
    editLevel = connection.level;
  });

  function commitFullName(): void {
    if (editFullName === connection.full_name) return;
    onupdate({ full_name: editFullName });
  }

  function commitTags(): void {
    const tags = editTags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");
    if (tags.join("\u0000") === connection.tags.join("\u0000")) return;
    onupdate({ tags });
  }

  function commitLevel(): void {
    if (!Number.isInteger(editLevel) || editLevel === connection.level) return;
    onupdate({ level: editLevel });
  }

  let realizedRows = $derived(
    connection.realized_by.map((ref) => {
      const target = connectionByRef(connections, ref);
      return {
        ref,
        found: target !== undefined,
        protocol: target?.protocol,
        complete: target?.complete ?? false,
        placed: placedLabels.includes(ref.label),
      };
    }),
  );

  // Every other connection that is not already a realization. No
  // compatibility filter: invalid choices surface as the compiler's warnings.
  let realizationCandidates = $derived.by(() => {
    const self = connectionRefKey(connection.ref);
    const realized = new Set(connection.realized_by.map(connectionRefKey));
    return connections.filter((candidate) => {
      const key = connectionRefKey(candidate.ref);
      return key !== self && !realized.has(key);
    });
  });

  function addRealization(key: string): void {
    const target = realizationCandidates.find(
      (candidate) => connectionRefKey(candidate.ref) === key,
    );
    if (target === undefined) return;
    onupdate({ realized_by: [...connection.realized_by, target.ref] });
  }

  function removeRealization(key: string): void {
    onupdate({
      realized_by: connection.realized_by.filter(
        (ref) => connectionRefKey(ref) !== key,
      ),
    });
  }

  function refLabel(ref: ConnectionRef): string {
    return ref.scopePath === "" ? ref.label : `${ref.label} (${ref.scopePath})`;
  }

  // Endpoint component icons, resolved the same way as the component tree
  // (`ComponentHierarchyTree`): a FontAwesome name to drawable SVG geometry.
  // Missing/unknown names draw nothing, keeping the label's left edge straight.
  let fromIconData = $derived(resolveIcon(fromIcon ?? ""));
  let toIconData = $derived(resolveIcon(toIcon ?? ""));

  let roleSummary = $derived(
    protocol === undefined || protocol.roles.length === 0
      ? "any"
      : protocol.roles.join(", "),
  );
</script>

{#snippet portList(
  title: string,
  ports: readonly PortData[],
  connected: ReadonlySet<string>,
  testId: string,
)}
  <div class="space-y-1" data-testid={testId}>
    <span class="font-semibold text-base-content/70">{title}</span>
    {#if ports.length === 0}
      <p class="text-xs text-base-content/50 italic">No ports declared.</p>
    {:else}
      <ul class="space-y-1">
        {#each ports as port (port.label)}
          <li
            class="flex items-center justify-between gap-2 text-xs"
            data-testid="endpoint-port-row"
          >
            <span class="font-mono truncate">{port.label}</span>
            <span
              class="badge badge-xs {connected.has(port.label)
                ? 'badge-success'
                : 'badge-ghost'}"
              data-testid="port-connection-status"
              title={connected.has(port.label)
                ? "Some connection in the model ends on this port"
                : "No connection in the model ends on this port"}
            >
              {connected.has(port.label) ? "Connected" : "Not connected"}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

<div class="space-y-4 text-sm" data-testid="connection-inspector">
  <div>
    <div class="text-[11px] text-base-content/50 font-mono uppercase">
      Connection
    </div>
    <h4 class="text-base font-bold text-base-content truncate">
      {connection.ref.label}
    </h4>
  </div>

  <div
    class="space-y-2 bg-base-200 p-2.5 rounded-box border border-base-300 text-xs font-mono"
  >
    <div class="flex items-center justify-between">
      <span class="text-base-content/60">From:</span>
      <span
        class="flex items-center gap-1.5 font-semibold truncate max-w-[150px]"
      >
        {#if fromIconData}
          <svg
            viewBox={`0 0 ${fromIconData.width} ${fromIconData.height}`}
            class="w-3.5 h-3.5 shrink-0 fill-current text-base-content/60"
            aria-hidden="true"
          >
            <path d={fromIconData.svgPath} />
          </svg>
        {/if}
        <span class="truncate"
          >{fromLabel}{connection.from_port
            ? `.${connection.from_port}`
            : ""}</span
        >
      </span>
    </div>
    <div class="flex items-center justify-between">
      <span class="text-base-content/60">To:</span>
      <span
        class="flex items-center gap-1.5 font-semibold truncate max-w-[150px]"
      >
        {#if toIconData}
          <svg
            viewBox={`0 0 ${toIconData.width} ${toIconData.height}`}
            class="w-3.5 h-3.5 shrink-0 fill-current text-base-content/60"
            aria-hidden="true"
          >
            <path d={toIconData.svgPath} />
          </svg>
        {/if}
        <span class="truncate"
          >{toLabel}{connection.to_port ? `.${connection.to_port}` : ""}</span
        >
      </span>
    </div>

    <div class="divider my-0"></div>

    <div class="space-y-2" data-testid="endpoint-ports">
      <span
        class="text-[10px] font-semibold uppercase tracking-wider text-base-content/60"
      >
        Endpoint ports
      </span>
      {@render portList(
        `${fromLabel} ports`,
        fromPorts,
        fromConnectedPorts,
        "from-ports",
      )}
      {@render portList(
        `${toLabel} ports`,
        toPorts,
        toConnectedPorts,
        "to-ports",
      )}
    </div>
  </div>

  <!--
    Three panels. The protocol is shared by everything that uses it and is
    read-only here. The connection's own fields and its realization are written
    to the system model. The side pickers are written to the open view only.
    Each heading names its file on hover, like the node inspector.
  -->
  <div class="space-y-2" data-testid="protocol-attributes">
    <span
      class="tooltip tooltip-right block w-fit text-[10px] font-semibold uppercase tracking-wider text-base-content/50"
      data-testid="protocol-attributes-heading"
      data-tip={protocol === undefined
        ? `Defined by the protocol in ${SCOPE_FILE.model} — shared by every connection and port that uses it`
        : `Defined by protocol ${protocol.label} in ${SCOPE_FILE.model} — shared by every connection and port that uses it`}
    >
      Protocol
    </span>
    {#if protocol !== undefined}
      <div class="flex items-center justify-between">
        <span class="font-mono font-semibold">{protocol.label}</span>

        <a
          class="badge badge-ghost"
          href={inventoryProtocolHref(projectId, protocol.label)}
          data-testid="edit-protocol-link"
        >
          Edit protocol
        </a>

        {#if protocol.leaf}
          <span class="badge badge-ghost badge-xs">leaf</span>
        {/if}
      </div>
      {#if protocol.full_name !== ""}
        <div>{protocol.full_name}</div>
      {/if}
      <div class="text-xs text-base-content/70">
        Roles: <span class="font-mono">{roleSummary}</span>
      </div>
      <div class="text-xs text-base-content/70">
        Can carry:
        <span class="font-mono"
          >{protocol.encapsulates.length === 0
            ? "nothing"
            : protocol.encapsulates.join(", ")}</span
        >
      </div>
      {#if protocolUsage !== undefined}
        <div class="text-xs text-base-content/70">
          Used by {protocolUsage.connections} other
          {protocolUsage.connections === 1 ? "connection" : "connections"} and
          {protocolUsage.ports}
          {protocolUsage.ports === 1 ? "port" : "ports"}.
        </div>
      {/if}
    {:else}
      <p class="text-xs text-base-content/60" data-testid="protocol-reason">
        {protocolReason ?? "No protocol is shared by the endpoints."}
      </p>
    {/if}
  </div>

  <div class="divider my-1"></div>

  <div class="space-y-2" data-testid="connection-attributes">
    <span
      class="tooltip tooltip-right block w-fit text-[10px] font-semibold uppercase tracking-wider text-base-content/50"
      data-testid="connection-attributes-heading"
      data-tip={sharedWithCopies
        ? `Written to ${SCOPE_FILE.model} — applies to this connection and to its copies in every instance`
        : `Written to ${SCOPE_FILE.model} — applies to this connection only`}
    >
      Connection
    </span>

    <div class="form-control">
      <label class="label py-1" for="conn-full-name-input">
        <span
          class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70"
          >Full name</span
        >
      </label>
      <input
        id="conn-full-name-input"
        type="text"
        bind:value={editFullName}
        onblur={commitFullName}
        disabled={readonly}
        class="input input-sm input-bordered w-full"
      />
    </div>

    <div class="form-control">
      <label class="label py-1" for="conn-tags-input">
        <span
          class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70"
          >Tags (comma-separated)</span
        >
      </label>
      <input
        id="conn-tags-input"
        type="text"
        bind:value={editTags}
        onblur={commitTags}
        disabled={readonly}
        class="input input-sm input-bordered w-full"
      />
    </div>

    <div class="form-control">
      <label class="label py-1" for="conn-level-input">
        <span
          class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70"
          >Level</span
        >
      </label>
      <input
        id="conn-level-input"
        type="number"
        step="1"
        bind:value={editLevel}
        onchange={commitLevel}
        disabled={readonly}
        class="input input-sm input-bordered w-full"
      />
    </div>

    <div class="space-y-2 pt-1" data-testid="realization">
      <div class="flex items-center justify-between">
        <span
          class="text-xs font-semibold uppercase tracking-wider text-base-content/70"
          >Realization</span
        >
        <span
          class="badge badge-xs {connection.complete
            ? 'badge-success'
            : 'badge-warning'}"
          data-testid="realization-status"
        >
          {connection.complete ? "complete" : "incomplete"}
        </span>
      </div>
      {#if !connection.complete && connection.blocking !== undefined}
        <p class="text-xs text-base-content/70">
          Blocked by <span class="font-mono"
            >{refLabel(connection.blocking)}</span
          >
        </p>
      {/if}

      {#if realizedRows.length > 0}
        <ul class="space-y-1" data-testid="realized-by-list">
          {#each realizedRows as row (connectionRefKey(row.ref))}
            <li
              class="flex items-center gap-1.5 text-xs"
              data-testid="realized-by-row"
            >
              <span class="font-mono truncate">{refLabel(row.ref)}</span>
              {#if row.protocol}
                <span class="badge badge-ghost badge-xs">{row.protocol}</span>
              {/if}
              {#if row.found}
                <span
                  class="badge badge-xs {row.complete
                    ? 'badge-success'
                    : 'badge-warning'}"
                  >{row.complete ? "complete" : "incomplete"}</span
                >
              {:else}
                <span class="badge badge-error badge-xs">unresolved</span>
              {/if}
              <button
                class="btn btn-xs btn-ghost ml-auto"
                aria-label="Select {row.ref.label} on canvas"
                title={row.placed
                  ? "Select on canvas"
                  : "Not placed in this view"}
                disabled={!row.placed}
                onclick={() => onselect(row.ref)}>Show</button
              >
              <button
                class="btn btn-xs btn-ghost text-error"
                aria-label="Remove realization {row.ref.label}"
                title="Remove realization"
                disabled={readonly}
                onclick={() => removeRealization(connectionRefKey(row.ref))}
                >×</button
              >
            </li>
          {/each}
        </ul>
      {/if}

      <select
        class="select select-xs w-full"
        aria-label="Add realization"
        disabled={readonly || realizationCandidates.length === 0}
        onchange={(event) => {
          const value = event.currentTarget.value;
          event.currentTarget.value = "";
          if (value !== "") addRealization(value);
        }}
      >
        <option value="">Add realization…</option>
        {#each realizationCandidates as candidate (connectionRefKey(candidate.ref))}
          <option value={connectionRefKey(candidate.ref)}
            >{refLabel(candidate.ref)}</option
          >
        {/each}
      </select>
    </div>
  </div>

  <div class="divider my-2"></div>
  <button
    class="btn btn-xs btn-outline btn-error w-full"
    disabled={readonly}
    onclick={() => ondelete()}
  >
    Delete connection
  </button>
</div>
