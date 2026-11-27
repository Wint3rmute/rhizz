<script lang="ts">
  // The component-hierarchy sidebar for Modeling. Reuses the shared
  // `Tree` shell to render the nested component tree with expand/collapse,
  // mirroring how FileTree renders file/diagram hierarchies.
  //
  // Each row is a placement-affordance let loose from the canvas:
  //   - a checkbox to place/unplace the component on the canvas,
  //   - a label that selects the node (drives the canvas highlight +
  //     NodeInspector, all driven by ModelingPage's selection),
  //   - a component icon when one is provided.
  // Below a component (after its subcomponents) come its declared ports:
  // a role-coloured dot, a smaller muted label, and an eye toggle that
  // shows/hides the port in the open view — so an unconnected port (e.g. a
  // public interface) can be drawn. Clicking a port's label selects its
  // component.
  // It does no I/O and owns no model state — everything is passed in, so all
  // readProjectSources/compile/write logic stays in ModelingPage.svelte.
  import Tree from "../../../../components/Tree.svelte";
  import type { TreeNode } from "../../../../components/treeTypes";
  import { resolveIcon } from "../../../../iconHelper";
  import {
    buildComponentTree,
    buildSystemSubtree,
    type ComponentTreeComponent,
    type ComponentTreeSystem,
    parsePortRowId,
  } from "./componentTree";
  import type { PortRowState } from "./portVisibility";

  /** A declared port, as the tree lists it. */
  interface TreePort {
    label: string;
    role: "provider" | "consumer" | "peer";
    protocol?: string | undefined;
  }

  let {
    systems,
    components,
    selected,
    onSelectComponent,
    onToggleChecked,
    isChecked,
    onDeleteComponent,
    filterSystemLabel = null,
    portsOf,
    portState,
    onTogglePort,
  }: {
    systems: ComponentTreeSystem[];
    components: ComponentTreeComponent[];
    /** The canvas node selection (arena indices). Read-only: changes go through `onSelectComponent`. */
    selected: ReadonlySet<number>;
    /** Fired when a component row is clicked; ModelingPage.svelte makes it the sole selection. */
    onSelectComponent: (index: number) => void;
    /** When set, only this system's subtree is shown and the system root row is hidden. */
    filterSystemLabel?: string | null;
    /** True when the given arena index is currently placed on the canvas. */
    isChecked: (index: number) => boolean;
    /**
     * Fired when a row's checkbox is toggled; ModelingPage.svelte
     * places/unplaces it. Omitted while someone else holds the project —
     * the checkbox then renders disabled (state still visible) instead.
     */
    onToggleChecked?: ((index: number) => void) | undefined;
    /** Fired when a row's trash button is clicked; ModelingPage.svelte removes it from the model (after a confirm). */
    onDeleteComponent?: ((index: number) => void) | undefined;
    /** Declared ports of the component at an arena index. Omitted: no port rows. */
    portsOf?: ((index: number) => readonly TreePort[]) | undefined;
    /** How a port row's checkbox presents in the open view. */
    portState?: ((index: number, label: string) => PortRowState) | undefined;
    /**
     * Fired when a port row's checkbox is toggled; ModelingPage.svelte shows
     * or hides the port in the open view. Omitted while someone else holds
     * the project — the checkbox then renders disabled.
     */
    onTogglePort?: ((index: number, label: string) => void) | undefined;
  } = $props();

  let portLabelsOf = $derived(
    portsOf === undefined
      ? undefined
      : (index: number) => portsOf(index).map((port) => port.label),
  );

  let nodes = $derived(
    filterSystemLabel
      ? buildSystemSubtree(systems, components, filterSystemLabel, portLabelsOf)
      : buildComponentTree(systems, components, portLabelsOf),
  );

  const PORT_STATUS: Record<TreePort["role"], string> = {
    provider: "status-success",
    consumer: "status-warning",
    peer: "status-info",
  };

  const PORT_TITLE: Record<PortRowState, string> = {
    unplaced: "Place the component to show its ports",
    connected: "Cannot hide a port which is used by a connection in this view",
    shown: "Shown in this view",
    hidden: "Hidden in this view",
  };

  // The `Tree` shell highlights a single `selectedId`. When exactly one
  // component is selected, that component's row is highlighted.
  let selectedIndex = $derived(
    selected.size === 1 ? String(selected.values().next().value ?? "") : null,
  );

  function onSelectRow(entry: TreeNode) {
    // A port row selects the component that owns it.
    const port = parsePortRowId(entry.id);
    const index = port !== null ? port.index : nodeIndex(entry);
    if (index === null) return;
    onSelectComponent(index);
  }

  function nodeIndex(entry: TreeNode): number | null {
    // Only component rows have numeric ids; system roots start with "sys:",
    // port rows with "port:".
    if (entry.id.startsWith("sys:")) return null;
    const n = Number(entry.id);
    return Number.isNaN(n) ? null : n;
  }
</script>

{#snippet compTail(entry: TreeNode)}
  {@const index = nodeIndex(entry)}
  {#if index !== null && onDeleteComponent}
    <button
      type="button"
      class="text-xs text-base-content/60 hover:text-error"
      title="Delete from the model"
      aria-label={`Delete component ${components[index]?.label ?? ""}`}
      onclick={() => onDeleteComponent?.(index)}>🗑</button
    >
  {/if}
{/snippet}

{#snippet portLeading(index: number, label: string)}
  {@const state = portState?.(index, label) ?? "hidden"}
  {@const port = portsOf?.(index).find((entry) => entry.label === label)}
  {@const on = state === "connected" || state === "shown"}
  {@const icon = resolveIcon(on ? "eye" : "eye-slash")}
  <!-- An eye toggle, not a checkbox: sets port rows apart from subcomponent
       rows, whose checkbox places them on the canvas. -->
  <!-- A disabled button swallows pointer events (no cursor, no title), so the
       wrapper carries the blocked cursor and the tooltip. -->
  <span
    class="inline-flex shrink-0 {state === 'connected'
      ? 'cursor-not-allowed'
      : ''}"
    data-testid="port-visibility-wrapper"
    title={PORT_TITLE[state]}
  >
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-square h-4 min-h-0 w-4 {on
        ? 'text-base-content/80'
        : 'text-base-content/30'}"
      data-testid="port-visibility"
      aria-label={`Show port ${label}`}
      aria-pressed={on}
      disabled={onTogglePort === undefined ||
        state === "unplaced" ||
        state === "connected"}
      onclick={() => onTogglePort?.(index, label)}
    >
      {#if icon}
        <svg
          viewBox={`0 0 ${icon.width} ${icon.height}`}
          class="w-3 h-3 fill-current"
          aria-hidden="true"
        >
          <path d={icon.svgPath} />
        </svg>
      {/if}
    </button>
  </span>
  <span
    class="status shrink-0 {PORT_STATUS[port?.role ?? 'peer']}"
    title={`Port ${label} (${port?.role ?? "peer"}, ${port?.protocol || "untyped"})`}
    data-testid="port-role-dot"
    aria-hidden="true"
  ></span>
{/snippet}

{#snippet compLeading(entry: TreeNode)}
  {@const port = parsePortRowId(entry.id)}
  {@const index = port === null ? nodeIndex(entry) : null}
  {#if port !== null}
    {@render portLeading(port.index, port.label)}
  {:else}
    {@render componentLeading(index)}
  {/if}
{/snippet}

{#snippet componentLeading(index: number | null)}
  {@const icon =
    index !== null ? resolveIcon(components[index]?.icon ?? "") : null}
  {#if index !== null}
    <input
      type="checkbox"
      class="checkbox checkbox-xs shrink-0"
      checked={isChecked(index)}
      disabled={onToggleChecked === undefined}
      onchange={() => onToggleChecked?.(index)}
    />
  {:else}
    <span class="w-4 shrink-0"></span>
  {/if}
  {#if icon}
    <svg
      viewBox={`0 0 ${icon.width} ${icon.height}`}
      class="w-3.5 h-3.5 shrink-0 fill-current text-base-content/60"
      aria-hidden="true"
    >
      <path d={icon.svgPath} />
    </svg>
  {/if}
{/snippet}

<Tree
  {nodes}
  bind:selectedId={selectedIndex}
  emptyMessage="No components found."
  showExpandCollapseAll
  leading={compLeading}
  rowTail={compTail}
  onselect={onSelectRow}
/>
