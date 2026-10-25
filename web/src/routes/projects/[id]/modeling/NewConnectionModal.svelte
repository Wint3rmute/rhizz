<script lang="ts">
  // "New connection" dialog. Opens when an arrow is dragged between two
  // components and creates the connection together with one new port on each
  // end, as a single undoable step. Nothing but the protocol needs a decision:
  // every other field is prefilled, and Enter creates with the defaults.
  //
  // The decision logic (defaults, validation, the op sent) lives in
  // `newConnection.ts`; this file is the form around it.
  import { untrack } from "svelte";
  import type { ModelMutationOp } from "../../../../history/applyMutation";
  import type { ProtocolData } from "../../../../modelView";
  import {
    type ConnectionDraft,
    type NewConnectionRequest,
    buildConnectOp,
    connectionDirection,
    initialDraft,
    orderProtocols,
    presetRoles,
    rememberProtocol,
    validateDraft,
  } from "./newConnection";

  interface Props {
    /** What is being connected; `null` keeps the dialog closed. */
    request: NewConnectionRequest | null;
    protocols: readonly ProtocolData[];
    /** How many ports name each protocol, to float the used ones up. */
    protocolUsage: ReadonlyMap<string, number>;
    /** Every connection label in the model (views key connections by name). */
    takenConnectionLabels: readonly string[];
    oncreate: (op: ModelMutationOp) => void;
    onclose: () => void;
  }

  let {
    request,
    protocols,
    protocolUsage,
    takenConnectionLabels,
    oncreate,
    onclose,
  }: Props = $props();

  let draft = $state<ConnectionDraft | null>(null);
  let nameInput = $state<HTMLInputElement | undefined>(undefined);
  let listOpen = $state(false);
  let activeIndex = $state(-1);

  // Roles are reset whenever the protocol changes between "none", "a protocol
  // that will be created" and "an existing protocol" (or to another existing
  // one) — the role options belong to the protocol. Retyping within one state
  // keeps whatever the user picked.
  let presetKey = "";

  $effect(() => {
    if (request === null) {
      draft = null;
      return;
    }
    draft = untrack(() =>
      initialDraft(request, { takenConnectionLabels, protocols }),
    );
    listOpen = false;
    activeIndex = -1;
    presetKey = "";
  });

  // Focus the name once the dialog is on screen. A plain `autofocus` is not
  // enough: the dialog opens from the end of a mouse drag, and the `click`
  // that follows the mouse-up hands focus back to the canvas. Waiting for the
  // next frame lets that settle, so Enter works right away. Focus the user
  // already moved into the dialog is left alone.
  $effect(() => {
    const input = nameInput;
    if (input === undefined) return;
    const frame = requestAnimationFrame(() => {
      const dialog = input.closest('[role="dialog"]');
      if (dialog?.contains(document.activeElement)) return;
      input.focus();
    });
    return () => cancelAnimationFrame(frame);
  });

  let validation = $derived(
    request !== null && draft !== null
      ? validateDraft(request, draft, { takenConnectionLabels, protocols })
      : null,
  );

  let protocolText = $derived(draft?.protocol.trim() ?? "");
  let activeProtocol = $derived(
    protocols.find((p) => p.label === protocolText),
  );
  let isNewProtocol = $derived(
    protocolText !== "" &&
      activeProtocol === undefined &&
      !protocolText.includes("/"),
  );

  type ProtocolOption =
    | { kind: "existing"; protocol: ProtocolData }
    | { kind: "create"; label: string };

  let options = $derived.by<ProtocolOption[]>(() => {
    const query = protocolText.toLowerCase();
    const ordered = orderProtocols(protocols, protocolUsage);
    const matching =
      query === ""
        ? ordered
        : ordered.filter((p) => p.label.toLowerCase().includes(query));
    const list: ProtocolOption[] = matching.map((protocol) => ({
      kind: "existing",
      protocol,
    }));
    if (isNewProtocol) list.push({ kind: "create", label: protocolText });
    return list;
  });

  let fromEnd = $derived(request?.from);
  let toEnd = $derived(request?.to);

  function setProtocol(text: string) {
    if (draft === null) return;
    draft.protocol = text;
    const trimmed = text.trim();
    const resolved = protocols.find((p) => p.label === trimmed);
    const key =
      trimmed === ""
        ? ""
        : resolved === undefined
          ? "new"
          : `existing:${resolved.label}`;
    if (key === presetKey) return;
    presetKey = key;
    const roles = presetRoles(resolved);
    draft.from.role = roles.from;
    draft.to.role = roles.to;
  }

  function pick(option: ProtocolOption) {
    setProtocol(
      option.kind === "existing" ? option.protocol.label : option.label,
    );
    listOpen = false;
    activeIndex = -1;
  }

  function onProtocolKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      listOpen = true;
      const step = event.key === "ArrowDown" ? 1 : options.length - 1;
      activeIndex = (activeIndex + step) % options.length;
      return;
    }
    if (event.key === "Enter" && listOpen && activeIndex >= 0) {
      const option = options[activeIndex];
      if (option !== undefined) {
        event.preventDefault();
        pick(option);
      }
      return;
    }
    if (event.key === "Escape" && listOpen) {
      event.preventDefault();
      event.stopPropagation();
      listOpen = false;
      activeIndex = -1;
    }
  }

  function submit() {
    if (request === null || draft === null || validation?.valid !== true) {
      return;
    }
    if (protocolText !== "") rememberProtocol(protocolText);
    oncreate(buildConnectOp(request, draft, protocols));
  }

  // Enter in any text field or select creates, unless the protocol list just
  // claimed it to pick an option.
  function onFormKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.defaultPrevented) return;
    const target = event.target;
    const isTextField =
      target instanceof HTMLInputElement && target.type === "text";
    if (isTextField || target instanceof HTMLSelectElement) {
      event.preventDefault();
      submit();
    }
  }

  // ── Preview ────────────────────────────────────────────────────────────────

  function shorten(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  let fromPort = $derived(
    fromEnd?.existingPort ?? (draft?.from.name.trim() || "…"),
  );
  let toPort = $derived(toEnd?.existingPort ?? (draft?.to.name.trim() || "…"));
  let connectionName = $derived(draft?.label.trim() || "…");
  let direction = $derived(
    connectionDirection(
      fromEnd?.existingPort === undefined ? (draft?.from.role ?? "") : "",
      toEnd?.existingPort === undefined ? (draft?.to.role ?? "") : "",
    ),
  );
</script>

<svelte:window
  onkeydown={(e) => {
    if (request === null || e.key !== "Escape") return;
    onclose();
  }}
/>

{#if request !== null && draft !== null && fromEnd !== undefined && toEnd !== undefined}
  <div
    class="modal modal-open z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center cursor-pointer"
    role="dialog"
    aria-modal="true"
    aria-label="New connection"
    data-testid="new-connection-modal"
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget) onclose();
    }}
    onkeydown={onFormKeydown}
  >
    <div
      class="modal-box max-w-2xl bg-base-100 border border-base-300 shadow-2xl p-6 rounded-box max-h-[90vh] flex flex-col cursor-default"
    >
      <div
        class="flex items-center justify-between pb-3 border-b border-base-300"
      >
        <h3 class="font-bold text-lg flex items-center gap-2">
          <span class="text-primary">+</span> New connection
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
        <svg
          viewBox="0 0 560 120"
          class="w-full h-28 shrink-0 text-base-content"
          role="img"
          aria-label="{fromEnd.label} connected to {toEnd.label}"
          data-testid="new-connection-preview"
        >
          <defs>
            <marker
              id="new-conn-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {#each [{ x: 10, end: fromEnd }, { x: 390, end: toEnd }] as box (box.x)}
            <rect
              x={box.x}
              y="25"
              width="160"
              height="70"
              rx="6"
              style="fill: var(--color-base-200); stroke: var(--color-base-300);"
              stroke-width="1.5"
            />
            <text
              x={box.x + 80}
              y="56"
              text-anchor="middle"
              font-size="14"
              font-weight="600"
              fill="currentColor">{shorten(box.end.label, 20)}</text
            >
            <text
              x={box.x + 80}
              y="75"
              text-anchor="middle"
              font-size="10"
              fill="currentColor"
              opacity="0.55">{shorten(box.end.key, 28)}</text
            >
          {/each}
          <line
            x1="170"
            y1="60"
            x2="390"
            y2="60"
            stroke="currentColor"
            stroke-width="2"
            stroke-dasharray="6 4"
            class="new-connection-flow"
            data-testid="new-connection-preview-line"
            marker-end={direction === "forward" || direction === "both"
              ? "url(#new-conn-arrow)"
              : undefined}
            marker-start={direction === "backward" || direction === "both"
              ? "url(#new-conn-arrow)"
              : undefined}
          />
          <rect
            x="164"
            y="54"
            width="12"
            height="12"
            rx="2"
            style="fill: var(--color-primary);"
          />
          <rect
            x="384"
            y="54"
            width="12"
            height="12"
            rx="2"
            style="fill: var(--color-primary);"
          />
          <text
            x="182"
            y="48"
            font-size="11"
            fill="currentColor"
            data-testid="new-connection-preview-from-port"
            >{shorten(fromPort, 18)}</text
          >
          <text
            x="378"
            y="48"
            text-anchor="end"
            font-size="11"
            fill="currentColor"
            data-testid="new-connection-preview-to-port"
            >{shorten(toPort, 18)}</text
          >
          <text
            x="280"
            y="82"
            text-anchor="middle"
            font-size="12"
            font-weight="600"
            fill="currentColor"
            data-testid="new-connection-preview-name"
            >{shorten(connectionName, 30)}</text
          >
        </svg>

        <div class="form-control">
          <label class="label py-1" for="new-conn-name">
            <span
              class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70"
            >
              Connection name <span class="text-error">*</span>
            </span>
          </label>
          <input
            id="new-conn-name"
            type="text"
            bind:this={nameInput}
            bind:value={draft.label}
            class="input input-sm input-bordered w-full font-medium"
            data-testid="new-connection-name"
            onfocus={(e) => e.currentTarget.select()}
          />
          {#if validation?.problems.label !== undefined}
            <p
              class="text-xs text-error mt-1"
              data-testid="new-connection-problem"
            >
              {validation.problems.label}
            </p>
          {/if}
        </div>

        <div class="form-control relative">
          <label class="label py-1" for="new-conn-protocol">
            <span
              class="label-text font-semibold text-xs uppercase tracking-wider text-base-content/70"
            >
              Protocol
            </span>
          </label>
          <input
            id="new-conn-protocol"
            type="text"
            role="combobox"
            aria-expanded={listOpen}
            aria-controls="new-conn-protocol-list"
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0
              ? `new-conn-protocol-option-${String(activeIndex)}`
              : undefined}
            value={draft.protocol}
            placeholder="No protocol (optional) — type to search or create"
            class="input input-sm input-bordered w-full"
            data-testid="new-connection-protocol"
            autocomplete="off"
            oninput={(e) => {
              setProtocol(e.currentTarget.value);
              listOpen = true;
              activeIndex = -1;
            }}
            onfocus={() => (listOpen = true)}
            onblur={() => {
              listOpen = false;
              activeIndex = -1;
            }}
            onkeydown={onProtocolKeydown}
          />
          {#if listOpen && options.length > 0}
            <ul
              id="new-conn-protocol-list"
              role="listbox"
              class="menu menu-sm w-full bg-base-100 border border-base-300 rounded-box shadow-lg absolute top-full left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto flex-nowrap"
              data-testid="new-connection-protocol-list"
            >
              {#each options as option, index (option.kind === "existing" ? `p:${option.protocol.label}` : "create")}
                <li
                  id="new-conn-protocol-option-{index}"
                  role="option"
                  aria-selected={index === activeIndex}
                >
                  <!-- mousedown, not click: the input must not blur first. -->
                  <button
                    type="button"
                    tabindex="-1"
                    class:menu-active={index === activeIndex}
                    data-testid="new-connection-protocol-option"
                    onmousedown={(e) => {
                      e.preventDefault();
                      pick(option);
                    }}
                  >
                    {#if option.kind === "existing"}
                      <span class="font-medium">{option.protocol.label}</span>
                      {#if option.protocol.roles.length > 0}
                        <span class="text-xs text-base-content/60"
                          >{option.protocol.roles.join(" / ")}</span
                        >
                      {/if}
                    {:else}
                      <span>
                        Create protocol
                        <span class="font-medium">“{option.label}”</span>
                      </span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if validation?.problems.protocol !== undefined}
            <p class="text-xs text-error mt-1">
              {validation.problems.protocol}
            </p>
          {:else if isNewProtocol}
            <p
              class="text-xs text-base-content/60 mt-1"
              data-testid="new-connection-protocol-hint"
            >
              “{protocolText}” will be created as an empty protocol.
            </p>
          {/if}
        </div>

        <div class="grid grid-cols-2 gap-3">
          {#each [{ side: "from", end: fromEnd, port: draft.from, nameProblem: validation?.problems.fromName, roleProblem: validation?.problems.fromRole }, { side: "to", end: toEnd, port: draft.to, nameProblem: validation?.problems.toName, roleProblem: validation?.problems.toRole }] as column (column.side)}
            <fieldset
              class="border border-base-300 rounded-box p-3 flex flex-col gap-2"
              data-testid="new-connection-{column.side}-column"
            >
              <legend class="px-1 text-sm font-semibold">
                {column.end.label}
                <span class="font-normal text-base-content/60">port</span>
              </legend>

              {#if column.end.existingPort !== undefined}
                <p class="text-sm" data-testid="new-connection-existing-port">
                  Uses the existing port
                  <span class="badge badge-sm badge-outline"
                    >{column.end.existingPort}</span
                  >
                </p>
              {:else}
                <div class="form-control">
                  <label class="label py-1" for="new-conn-{column.side}-name">
                    <span class="label-text text-xs text-base-content/70"
                      >Name</span
                    >
                  </label>
                  <input
                    id="new-conn-{column.side}-name"
                    type="text"
                    bind:value={column.port.name}
                    class="input input-sm input-bordered w-full"
                    data-testid="new-connection-{column.side}-name"
                    onfocus={(e) => e.currentTarget.select()}
                  />
                  {#if column.nameProblem !== undefined}
                    <p
                      class="text-xs text-error mt-1"
                      data-testid="new-connection-problem"
                    >
                      {column.nameProblem}
                    </p>
                  {/if}
                </div>

                <div class="form-control">
                  <label class="label py-1" for="new-conn-{column.side}-role">
                    <span class="label-text text-xs text-base-content/70"
                      >Role</span
                    >
                  </label>
                  {#if activeProtocol !== undefined && activeProtocol.roles.length > 0}
                    <select
                      id="new-conn-{column.side}-role"
                      bind:value={column.port.role}
                      class="select select-sm select-bordered w-full"
                      data-testid="new-connection-{column.side}-role"
                    >
                      {#each activeProtocol.roles as role (role)}
                        <option value={role}>{role}</option>
                      {/each}
                    </select>
                  {:else if protocolText !== ""}
                    <select
                      id="new-conn-{column.side}-role"
                      class="select select-sm select-bordered w-full"
                      data-testid="new-connection-{column.side}-role"
                      disabled
                    >
                      <option>No roles defined</option>
                    </select>
                  {:else}
                    <input
                      id="new-conn-{column.side}-role"
                      type="text"
                      bind:value={column.port.role}
                      placeholder="optional, e.g. provider"
                      class="input input-sm input-bordered w-full"
                      data-testid="new-connection-{column.side}-role"
                    />
                  {/if}
                  {#if column.roleProblem !== undefined}
                    <p class="text-xs text-error mt-1">
                      {column.roleProblem}
                    </p>
                  {/if}
                </div>

                <div class="flex flex-col">
                  <label class="label cursor-pointer justify-start gap-2 py-1">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      bind:checked={column.port.external}
                      data-testid="new-connection-{column.side}-external"
                    />
                    <span class="label-text text-sm">External port</span>
                  </label>
                  <label class="label cursor-pointer justify-start gap-2 py-1">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      bind:checked={column.port.required}
                      data-testid="new-connection-{column.side}-required"
                    />
                    <span class="label-text text-sm">Required</span>
                  </label>
                </div>
              {/if}
            </fieldset>
          {/each}
        </div>
      </div>

      <div class="modal-action border-t border-base-300 pt-3 mt-0">
        <button onclick={onclose} class="btn btn-sm btn-ghost">Cancel</button>
        <button
          onclick={submit}
          disabled={validation?.valid !== true}
          class="btn btn-sm btn-primary"
          data-testid="new-connection-create"
        >
          Create connection
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* A dashed preview that slowly flows from the connection origin (left) to
     the target (right). The line is 220 units long; one dash period is 10
     units, so animating the offset by one period loops seamlessly. Negative
     offsets move the dashes towards the end of the path. */
  .new-connection-flow {
    stroke-dashoffset: 0;
    animation: new-connection-flow 1s linear infinite;
  }

  @keyframes new-connection-flow {
    to {
      stroke-dashoffset: -10;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .new-connection-flow {
      animation: none;
    }
  }
</style>
