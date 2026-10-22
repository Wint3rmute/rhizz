<script lang="ts">
  import type { ConnectionPatch, ConnectionRef } from "../../../../actionLog";
  import type { ConnectionSide } from "./geometry";
  import {
    connectionByRef,
    connectionRefKey,
    type ConnectionData,
    type PortData,
    type ProtocolData,
  } from "../../../../modelView";
  import { inventoryProtocolHref } from "../inventory/protocolLink";

  interface Props {
    /** The project the inspector belongs to, for the protocol deep link. */
    projectId: string | null;
    /** The connection being inspected. */
    connection: ConnectionData;
    /** Every connection in the model, to resolve realization targets. */
    connections: readonly ConnectionData[];
    /** Labels of the components at each end, for the side pickers. */
    fromLabel: string;
    toLabel: string;
    /** Ports declared on the from/to endpoint component instances. */
    fromPorts: readonly PortData[];
    toPorts: readonly PortData[];
    /**
     * Labels of those ports that a connection in the model ends on. Per placed
     * instance: two instances of one definition can differ.
     */
    fromConnectedPorts: ReadonlySet<string>;
    toConnectedPorts: ReadonlySet<string>;
    startSide: ConnectionSide | undefined;
    endSide: ConnectionSide | undefined;
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
    onsetstartside: (side: ConnectionSide | undefined) => void;
    onsetendside: (side: ConnectionSide | undefined) => void;
    ondelete: () => void;
  }

  // Which file each panel's attributes are written to, named the way the user
  // would: the model file, or the open view's own file. `<view>` is a
  // placeholder -- the inspector does not know which view is open.
  const SCOPE_FILE = { model: "system.hcl", view: "views/<view>.hcl" };

  // The five routing choices offered for each endpoint: "Auto" (no override,
  // the router picks a side) plus the four border sides.
  const SIDE_OPTIONS: {
    value: ConnectionSide | undefined;
    label: string;
  }[] = [
    { value: undefined, label: "Auto" },
    { value: "top", label: "Top" },
    { value: "right", label: "Right" },
    { value: "bottom", label: "Bottom" },
    { value: "left", label: "Left" },
  ];

  let {
    projectId,
    connection,
    connections,
    fromLabel,
    toLabel,
    fromPorts,
    toPorts,
    fromConnectedPorts,
    toConnectedPorts,
    startSide,
    endSide,
    sharedWithCopies,
    protocol,
    protocolReason,
    protocolUsage,
    placedLabels,
    onupdate,
    onselect,
    onsetstartside,
    onsetendside,
    ondelete,
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

  let roleSummary = $derived(
    protocol === undefined || protocol.roles.length === 0
      ? "any"
      : protocol.roles.join(", "),
  );
</script>

{#snippet sidePicker(
  title: string,
  current: ConnectionSide | undefined,
  onchange: (side: ConnectionSide | undefined) => void,
)}
  <!-- One endpoint's routing override. Keyed on the label because `value` is
       undefined for "Auto". -->
  <div class="space-y-1.5 pt-1">
    <span
      class="text-xs font-semibold uppercase tracking-wider text-base-content/70"
    >
      {title}
    </span>
    <div class="grid grid-cols-5 gap-1 w-full">
      {#each SIDE_OPTIONS as option (option.label)}
        <button
          class="btn btn-xs {current === option.value
            ? 'btn-primary'
            : 'btn-ghost border border-base-300'}"
          onclick={() => onchange(option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>
{/snippet}

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
      <span class="font-semibold truncate max-w-[150px]"
        >{fromLabel}{connection.from_port
          ? `.${connection.from_port}`
          : ""}</span
      >
    </div>
    <div class="flex items-center justify-between">
      <span class="text-base-content/60">To:</span>
      <span class="font-semibold truncate max-w-[150px]"
        >{toLabel}{connection.to_port ? `.${connection.to_port}` : ""}</span
      >
    </div>

    <div class="divider my-0"></div>

    <div class="space-y-2" data-testid="endpoint-ports">
      <div class="flex items-center justify-between gap-2">
        <span
          class="text-[10px] font-semibold uppercase tracking-wider text-base-content/60"
        >
          Endpoint ports
        </span>
        <span class="text-[10px] text-base-content/50">per placed instance</span
        >
      </div>
      <p class="text-[11px] text-base-content/60">
        A port counts as connected when any connection in the model ends on it
        for this component instance.
      </p>
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
      <div class="flex items-center gap-2">
        <span class="font-mono font-semibold">{protocol.label}</span>
        {#if protocol.leaf}
          <span class="badge badge-ghost badge-xs">leaf</span>
        {/if}
      </div>
      {#if protocol.full_name !== ""}
        <div class="text-xs">{protocol.full_name}</div>
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
      <a
        class="link link-primary text-xs"
        href={inventoryProtocolHref(projectId, protocol.label)}
        data-testid="edit-protocol-link"
      >
        Edit protocol
      </a>
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
        disabled={realizationCandidates.length === 0}
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

  <div class="divider my-1"></div>

  <div class="space-y-1 pt-1" data-testid="view-attributes">
    <span
      class="tooltip tooltip-right block w-fit text-[10px] font-semibold uppercase tracking-wider text-base-content/50"
      data-testid="view-attributes-heading"
      data-tip="Written to {SCOPE_FILE.view} — these apply to this diagram only"
    >
      This view
    </span>
    {@render sidePicker(
      `${fromLabel} starting point`,
      startSide,
      onsetstartside,
    )}
    {@render sidePicker(`${toLabel} starting point`, endSide, onsetendside)}
  </div>

  <div class="divider my-2"></div>
  <button
    class="btn btn-xs btn-outline btn-error w-full"
    onclick={() => ondelete()}
  >
    Delete connection
  </button>
</div>
