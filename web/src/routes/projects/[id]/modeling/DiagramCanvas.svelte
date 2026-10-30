<svelte:options namespace="svg" />

<script lang="ts">
  // The one SVG fragment every Rhizz diagram is drawn with. It is not an
  // <svg>: the host owns the camera (viewBox, pan, zoom) and the pointer
  // handlers on that element. This component turns a scene into nodes, edges,
  // notes, and overlays, and reports which thing was hit. Paths are recomputed
  // from boxes on every render so a later tween can move boxes without morphing
  // path strings.
  import { SvelteMap } from "svelte/reactivity";
  import AnnotationText from "./AnnotationText.svelte";
  import DiagramNodeBody from "./DiagramNodeBody.svelte";
  import DiagramPortLabel from "./DiagramPortLabel.svelte";
  import {
    annotationBounds,
    computeDirectionalHandles,
    computePortPositions,
    computeResizeHandles,
    computeVisibleConnections,
    type ConnectionSide,
    elbowPath,
    type PortAnchor,
    type ResizeHandle,
  } from "./geometry";
  import { resolveIcon } from "../../../../iconHelper";
  import {
    SELECTION_OUTLINE_DASHARRAY,
    SELECTION_OUTLINE_OPACITY,
  } from "./visuals";
  import type { DiagramNode, DiagramScene } from "./scene";
  import { portsUsedByEdges } from "./scene";

  // Same hit-area sizes the modeling page used before this canvas existed.
  const CORNER_HANDLE_SIZE = 10;
  const EDGE_HANDLE_THICKNESS = 6;

  let {
    scene,
    markerId = "arrow",
    linkNodes = false,
    linkLabel,
    busy = false,
    onNodePointerDown,
    onNodeClick,
    onNodeDblClick,
    onNodeContextMenu,
    onNodeHover,
    onPortPointerDown,
    onPortDragStart,
    onResizePointerDown,
    onEdgeClick,
    onEdgeContextMenu,
    onNotePointerDown,
    onNoteDblClick,
    onNoteContextMenu,
    onNoteResizePointerDown,
    frozen = false,
    revealAllPorts = false,
  }: {
    scene: DiagramScene;
    /** Prefix for the arrow markers, so two canvases on one page do not share an id. */
    markerId?: string | undefined;
    /** Wrap each node in `<a>`, preserving the read-only DOM contract (`a > g > g`). */
    linkNodes?: boolean | undefined;
    /**
     * How a linked node announces itself, for surfaces whose click means
     * something other than "open its detailed view" — the default wording would
     * then be a small lie to anyone listening. Omit to use {@link detailLabel}.
     */
    linkLabel?: ((node: DiagramNode) => string) | undefined;
    /** Auto-layout is writing positions; node and resize cursors become `wait`. */
    busy?: boolean | undefined;
    onNodePointerDown?:
      ((event: MouseEvent, index: number) => void) | undefined;
    onNodeClick?: ((index: number) => void) | undefined;
    onNodeDblClick?: ((event: MouseEvent, index: number) => void) | undefined;
    onNodeContextMenu?:
      ((event: MouseEvent, index: number) => void) | undefined;
    onNodeHover?:
      ((index: number | null, event?: MouseEvent) => void) | undefined;
    onPortPointerDown?:
      | ((
          event: MouseEvent,
          index: number,
          portLabel: string | null,
          worldPoint: { x: number; y: number },
          startSide?: ConnectionSide | undefined,
        ) => void)
      | undefined;
    /** Perimeter-slider drag of a port dot (plain left-drag). Alt/Shift+drag
     * on a port still starts a connection via `onPortPointerDown`. */
    onPortDragStart?:
      | ((event: MouseEvent, index: number, portLabel: string) => void)
      | undefined;
    onResizePointerDown?:
      | ((event: MouseEvent, index: number, handle: ResizeHandle) => void)
      | undefined;
    onEdgeClick?:
      | ((
          event: MouseEvent,
          edge: { label: string; from: number; to: number },
        ) => void)
      | undefined;
    onEdgeContextMenu?:
      ((event: MouseEvent, label: string) => void) | undefined;
    onNotePointerDown?:
      ((event: MouseEvent, index: number) => void) | undefined;
    onNoteDblClick?: ((event: MouseEvent, index: number) => void) | undefined;
    onNoteContextMenu?:
      ((event: MouseEvent, index: number) => void) | undefined;
    onNoteResizePointerDown?:
      | ((event: MouseEvent, index: number, handle: ResizeHandle) => void)
      | undefined;
    /** Ignore hits while a transition is moving nodes out from under the cursor. */
    frozen?: boolean | undefined;
    /** Show every port regardless of connections — set while a connection drag
     * is in progress so drop targets stay visible. Resting state shows only
     * ports a drawn edge names. */
    revealAllPorts?: boolean | undefined;
  } = $props();

  function fade(opacity: number | undefined): number | undefined {
    return opacity !== undefined && opacity < 1 ? opacity : undefined;
  }

  // Marker heads are painted in their own viewport and ignore the path's
  // opacity, so a fading connection would leave a solid arrow behind. The
  // head is drawn in the same group as the line; the last elbow segment
  // always arrives along the end-orientation axis.
  function arrowHead(
    tipX: number,
    tipY: number,
    dirX: number,
    dirY: number,
  ): string {
    const backX = tipX - dirX * 8;
    const backY = tipY - dirY * 8;
    const sideX = -dirY * 3;
    const sideY = dirX * 3;
    return `${tipX},${tipY} ${backX + sideX},${backY + sideY} ${backX - sideX},${
      backY - sideY
    }`;
  }

  let selectedMarkerId = $derived(`${markerId}-selected`);
  // Dots are an editing affordance: they render only where a gesture can
  // start one (the modeling page passes handlers; read-only scenes pass
  // neither and get labels only). Labels always render.
  let portsInteractive = $derived(
    onPortDragStart !== undefined || onPortPointerDown !== undefined,
  );
  // Hovered port dot (`<node index>:<port label>`), for the hover pop.
  // Modeling-only affordance: read-only scenes render no ports, so this
  // stays null there and costs nothing.
  let hoveredPortKey: string | null = $state(null);
  let edgeInteractive = $derived(
    onEdgeClick !== undefined || onEdgeContextMenu !== undefined,
  );
  let notesInteractive = $derived(
    onNotePointerDown !== undefined ||
      onNoteDblClick !== undefined ||
      onNoteContextMenu !== undefined ||
      onNoteResizePointerDown !== undefined,
  );

  let boxesByIndex = $derived.by(() => {
    const map = new SvelteMap<number, DiagramNode["box"]>();
    for (const node of scene.nodes) map.set(node.index, node.box);
    return map;
  });

  // World-space port dots per node, for follow-the-dot edge anchoring.
  // Key: node index → port label → { x, y (world), side }.
  let portWorldByNode = $derived.by(() => {
    const outer = new SvelteMap<number, SvelteMap<string, PortAnchor>>();
    for (const node of scene.nodes) {
      if (node.ports.length === 0) continue;
      const inner = new SvelteMap<string, PortAnchor>();
      for (const port of computePortPositions(
        node.box.width,
        node.box.height,
        node.ports,
      )) {
        inner.set(port.label, {
          x: node.box.x + port.x,
          y: node.box.y + port.y,
          side: port.side,
        });
      }
      outer.set(node.index, inner);
    }
    return outer;
  });

  let visibleEdges = $derived.by(() =>
    computeVisibleConnections(
      scene.edges,
      (index) => boxesByIndex.get(index),
      (index, portLabel) => portWorldByNode.get(index)?.get(portLabel),
    ),
  );

  function worldPoint(
    node: DiagramNode,
    local: { x: number; y: number },
  ): { x: number; y: number } {
    return { x: node.box.x + local.x, y: node.box.y + local.y };
  }

  function portFill(role: DiagramNode["ports"][number]["role"]): string {
    if (role === "provider") return "var(--color-success)";
    if (role === "consumer") return "var(--color-warning)";
    return "var(--color-info)";
  }

  function detailLabel(node: DiagramNode): string {
    return `${node.label}${
      node.dimmed ? ", no detailed view" : ", open detailed view"
    }`;
  }
</script>

<defs>
  <marker
    id={markerId}
    markerWidth="8"
    markerHeight="6"
    refX="8"
    refY="3"
    orient="auto"
  >
    <polygon
      points="0 0, 8 3, 0 6"
      fill="var(--color-base-content)"
      fill-opacity="0.5"
    />
  </marker>
  <marker
    id={selectedMarkerId}
    markerWidth="8"
    markerHeight="6"
    refX="8"
    refY="3"
    orient="auto"
  >
    <polygon points="0 0, 8 3, 0 6" fill="var(--color-primary)" />
  </marker>
</defs>

{#snippet nodeGraphic(node: DiagramNode)}
  {@const showConnect = node.handles === "connect" || node.handles === "both"}
  {@const showResize = node.handles === "resize" || node.handles === "both"}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <g
    data-testid="diagram-node"
    data-node-id={node.id}
    transform="translate({node.box.x}, {node.box.y})"
    class:cursor-pointer={onNodeClick !== undefined}
    class:opacity-90={node.dimmed}
    opacity={fade(node.opacity)}
    style:pointer-events={frozen || fade(node.opacity) !== undefined
      ? "none"
      : undefined}
    style:cursor={onNodePointerDown !== undefined
      ? busy
        ? "wait"
        : "grab"
      : undefined}
    onmousedown={onNodePointerDown
      ? (event) => onNodePointerDown?.(event, node.index)
      : undefined}
    ondblclick={onNodeDblClick
      ? (event) => onNodeDblClick?.(event, node.index)
      : undefined}
    oncontextmenu={onNodeContextMenu
      ? (event) => onNodeContextMenu?.(event, node.index)
      : undefined}
    onmouseenter={onNodeHover
      ? (event) => onNodeHover?.(node.index, event)
      : undefined}
    onmousemove={onNodeHover
      ? (event) => onNodeHover?.(node.index, event)
      : undefined}
    onmouseleave={onNodeHover
      ? (event) => onNodeHover?.(null, event)
      : undefined}
  >
    <DiagramNodeBody
      label={node.label}
      width={node.box.width}
      height={node.box.height}
      textAlign={node.box.textAlign}
      icon={resolveIcon(node.icon)}
      color={node.color}
      border={node.border}
      font={node.font}
      selected={node.selected}
    />
    {#if node.reparentTarget}
      <rect
        data-testid="diagram-reparent-target"
        x={-4}
        y={-4}
        width={node.box.width + 8}
        height={node.box.height + 8}
        rx="8"
        fill="none"
        stroke="var(--color-primary)"
        stroke-width="2"
        stroke-dasharray="4 4"
        class="animate-pulse"
        style="pointer-events: none"
      />
    {/if}
    {#if showResize}
      {#each computeResizeHandles(node.box.width, node.box.height, CORNER_HANDLE_SIZE, EDGE_HANDLE_THICKNESS) as handle (handle.handle)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <rect
          data-testid="diagram-resize-handle"
          x={handle.x}
          y={handle.y}
          width={handle.width}
          height={handle.height}
          fill="transparent"
          style="cursor: {busy ? 'wait' : handle.cursor}"
          onmousedown={onResizePointerDown
            ? (event) => onResizePointerDown?.(event, node.index, handle.handle)
            : undefined}
        />
      {/each}
    {/if}
    {#if showConnect}
      {#each computeDirectionalHandles(node.box.width, node.box.height) as handle (handle.side)}
        <g
          data-testid="diagram-side-handle"
          transform="translate({handle.x}, {handle.y})"
        >
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle
            r="8"
            fill="transparent"
            class="cursor-crosshair"
            onmousedown={onPortPointerDown
              ? (event) =>
                  onPortPointerDown?.(
                    event,
                    node.index,
                    null,
                    worldPoint(node, handle),
                    handle.side,
                  )
              : undefined}
          >
            <title>Drag connection from {handle.side}</title>
          </circle>
          <circle
            r="3.5"
            fill="var(--color-primary)"
            fill-opacity="0.85"
            stroke="var(--color-base-100)"
            stroke-width="1"
            style="pointer-events: none"
          />
        </g>
      {/each}
    {/if}
  </g>
{/snippet}

{#each scene.nodes as node (node.id)}
  {#if linkNodes}
    <!--
      The <g> is what makes the <a> an SVG anchor. Without an SVG ancestor
      in this file, Svelte compiles <a> (and then the root <defs>) as HTML,
      and the link has no box.
    -->
    <g>
      <a
        href={onNodeClick ? "#" : undefined}
        style:pointer-events={frozen ? "none" : undefined}
        aria-label={onNodeClick
          ? linkLabel
            ? linkLabel(node)
            : detailLabel(node)
          : undefined}
        onclick={onNodeClick
          ? (event) => {
              event.preventDefault();
              onNodeClick?.(node.index);
            }
          : undefined}
        onmouseenter={onNodeHover
          ? (event) => onNodeHover?.(node.index, event)
          : undefined}
        onmousemove={onNodeHover
          ? (event) => onNodeHover?.(node.index, event)
          : undefined}
        onmouseleave={onNodeHover
          ? (event) => onNodeHover?.(null, event)
          : undefined}
      >
        {@render nodeGraphic(node)}
      </a>
    </g>
  {:else}
    {@render nodeGraphic(node)}
  {/if}
{/each}

<!--
  Connections are drawn after nodes so arrows and labels are never hidden
  behind an opaque node fill. A route may still cross an unrelated node;
  dodging nodes is a separate routing change.
-->
{#each visibleEdges as { conn, a, b, orientation, endOrientation } (conn.id)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <g
    data-testid="diagram-edge"
    opacity={fade(conn.opacity)}
    style:pointer-events={frozen || fade(conn.opacity) !== undefined
      ? "none"
      : undefined}
    class:cursor-pointer={edgeInteractive}
    onclick={onEdgeClick ? (event) => onEdgeClick?.(event, conn) : undefined}
    oncontextmenu={onEdgeContextMenu
      ? (event) => onEdgeContextMenu?.(event, conn.label)
      : undefined}
  >
    {#if edgeInteractive}
      <path
        d={elbowPath(a.x, a.y, b.x, b.y, orientation, 10, endOrientation)}
        stroke="transparent"
        stroke-width="14"
        fill="none"
      />
    {/if}
    <path
      d={elbowPath(a.x, a.y, b.x, b.y, orientation, 10, endOrientation)}
      stroke={conn.selected
        ? "var(--color-primary)"
        : "var(--color-base-content)"}
      stroke-opacity={conn.selected ? 1 : 0.35}
      stroke-width={conn.selected ? 2.5 : 1.5}
      fill="none"
      style={edgeInteractive ? undefined : "pointer-events: none"}
    />
    <polygon
      points={arrowHead(
        b.x,
        b.y,
        endOrientation === "horizontal" ? (b.x >= a.x ? 1 : -1) : 0,
        endOrientation === "vertical" ? (b.y >= a.y ? 1 : -1) : 0,
      )}
      fill={conn.selected
        ? "var(--color-primary)"
        : "var(--color-base-content)"}
      fill-opacity={conn.selected ? 1 : 0.5}
      style="pointer-events: none"
    />
    <text
      x={(a.x + b.x) / 2}
      y={(a.y + b.y) / 2 - 6}
      fill={conn.selected
        ? "var(--color-primary)"
        : "var(--color-base-content)"}
      fill-opacity={conn.selected ? 1 : 0.5}
      font-size="10"
      font-weight={conn.selected ? "bold" : undefined}
      text-anchor="middle"
      style={edgeInteractive
        ? "user-select: none"
        : "pointer-events: none; user-select: none"}
    >
      {conn.label}
    </text>
  </g>
{/each}

<!--
  Ports above connections: edges are drawn after node bodies so crossing
  lines stay visible over unrelated fills — but a line ending at a port
  would then bury the dot (worse when selected: thicker + primary). This
  layer re-draws ports on top of every edge.

  Visibility: a label and its dot show only for ports a drawn edge names
  (or while a connection drag reveals all drop targets) — ports whose
  connections are not in this view stay hidden, no matter what is selected
  or which subpage hosts the diagram. Positions stay stable (computed from
  all ports) so showing or hiding labels never reflows the outline.
-->
{#each scene.nodes as node (node.id)}
  {@const allPortPositions =
    node.ports.length > 0
      ? computePortPositions(node.box.width, node.box.height, node.ports)
      : []}
  {@const usedPortLabels = portsUsedByEdges(
    visibleEdges.map((visible) => visible.conn),
    node.index,
  )}
  {#each allPortPositions as port (port.label)}
    {@const portKey = `${String(node.index)}:${port.label}`}
    {@const hovered = hoveredPortKey === portKey}
    {@const world = worldPoint(node, port)}
    {@const labelVisible = revealAllPorts || usedPortLabels.has(port.label)}
    {@const dotVisible =
      portsInteractive && (revealAllPorts || usedPortLabels.has(port.label))}
    {#if labelVisible || dotVisible}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g
        data-testid="diagram-port"
        transform="translate({world.x}, {world.y})"
        opacity={fade(node.opacity)}
        style:pointer-events={frozen || fade(node.opacity) !== undefined
          ? "none"
          : undefined}
      >
        {#if labelVisible}
          <DiagramPortLabel
            label={port.label}
            side={port.side}
            color={node.color}
          />
        {/if}
        {#if dotVisible}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle
            r="8"
            fill="transparent"
            class={onPortDragStart ? "cursor-move" : "cursor-crosshair"}
            onmouseenter={() => (hoveredPortKey = portKey)}
            onmouseleave={() => {
              if (hoveredPortKey === portKey) hoveredPortKey = null;
            }}
            onmousedown={(event) => {
              // Plain left-drag moves the port along the outline;
              // Alt/Shift+drag starts a connection from the existing port.
              if (event.button !== 0) return;
              if (event.altKey || event.shiftKey) {
                onPortPointerDown?.(event, node.index, port.label, world);
              } else if (onPortDragStart) {
                onPortDragStart(event, node.index, port.label);
              } else {
                onPortPointerDown?.(event, node.index, port.label, world);
              }
            }}
          >
            <title
              >{`${port.label} (${port.role}, ${port.protocol || "untyped"}) — drag to move, Alt+drag to connect`}</title
            >
          </circle>
          <circle
            r="4"
            fill={portFill(port.role)}
            fill-opacity={hovered ? 1 : 0.85}
            stroke="var(--color-base-100)"
            stroke-width={hovered ? 2 : 1.5}
            style="pointer-events: none; transform-box: fill-box; transform-origin: center; transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), fill-opacity 150ms ease-out, stroke-width 150ms ease-out; transform: scale({hovered
              ? 1.4
              : 1})"
          />
        {/if}
      </g>
    {/if}
  {/each}
{/each}

{#each scene.notes as note (note.id)}
  {@const hit = annotationBounds(note)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <g
    opacity={fade(note.opacity)}
    style:pointer-events={frozen || fade(note.opacity) !== undefined
      ? "none"
      : undefined}
    class:cursor-grab={notesInteractive}
    onmousedown={onNotePointerDown
      ? (event) => onNotePointerDown?.(event, note.index)
      : undefined}
    oncontextmenu={onNoteContextMenu
      ? (event) => onNoteContextMenu?.(event, note.index)
      : undefined}
    ondblclick={onNoteDblClick
      ? (event) => onNoteDblClick?.(event, note.index)
      : undefined}
  >
    {#if notesInteractive}
      <rect
        x={hit.x}
        y={hit.y}
        width={hit.width}
        height={hit.height}
        fill="transparent"
        style="cursor: grab"
      />
    {/if}
    {#if note.selected}
      <rect
        data-testid="diagram-note-frame"
        x={hit.x}
        y={hit.y}
        width={hit.width}
        height={hit.height}
        rx="3"
        fill="none"
        stroke="var(--color-primary)"
        stroke-opacity={SELECTION_OUTLINE_OPACITY}
        stroke-width="1.5"
        stroke-dasharray={SELECTION_OUTLINE_DASHARRAY}
        style="pointer-events: none"
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <rect
        data-testid="diagram-note-resize"
        x={hit.x + hit.width - CORNER_HANDLE_SIZE}
        y={hit.y}
        width={CORNER_HANDLE_SIZE}
        height={CORNER_HANDLE_SIZE}
        fill="var(--color-primary)"
        fill-opacity="0.9"
        style="cursor: nesw-resize"
        onmousedown={onNoteResizePointerDown
          ? (event) => onNoteResizePointerDown?.(event, note.index, "top-right")
          : undefined}
      />
    {/if}
    <AnnotationText
      text={note.text}
      x={note.x}
      y={note.y}
      scale={note.scale}
      fill={note.selected
        ? "var(--color-primary)"
        : "var(--color-base-content)"}
    />
  </g>
{/each}

{#each scene.overlays as overlay (`${overlay.type}-${overlay.type === "marquee" ? overlay.box.x : overlay.from.x}`)}
  {#if overlay.type === "marquee"}
    <rect
      data-testid="diagram-marquee"
      x={overlay.box.x}
      y={overlay.box.y}
      width={overlay.box.width}
      height={overlay.box.height}
      fill="var(--color-primary)"
      fill-opacity="0.15"
      stroke="var(--color-primary)"
      stroke-width="1"
      style="pointer-events: none"
    />
  {:else}
    <path
      data-testid="diagram-rubber-band"
      d={elbowPath(
        overlay.from.x,
        overlay.from.y,
        overlay.to.x,
        overlay.to.y,
        overlay.orientation,
      )}
      fill="none"
      stroke="var(--color-primary)"
      stroke-width="2"
      stroke-dasharray="4 4"
      marker-end="url(#{markerId})"
      class="animate-pulse"
      style="pointer-events: none"
    />
  {/if}
{/each}
