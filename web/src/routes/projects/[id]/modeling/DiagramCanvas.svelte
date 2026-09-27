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
import {
  annotationBounds,
  computeDirectionalHandles,
  computePortPositions,
  computeResizeHandles,
  computeVisibleConnections,
  type ConnectionSide,
  elbowPath,
  type ResizeHandle,
} from "./geometry";
import { resolveIcon } from "../../../../iconHelper";
import {
  SELECTION_OUTLINE_DASHARRAY,
  SELECTION_OUTLINE_OPACITY,
} from "./visuals";
import type { DiagramNode, DiagramScene } from "./scene";

// Same hit-area sizes the modeling page used before this canvas existed.
const CORNER_HANDLE_SIZE = 10;
const EDGE_HANDLE_THICKNESS = 6;

let {
  scene,
  markerId = "arrow",
  linkNodes = false,
  busy = false,
  onNodePointerDown,
  onNodeClick,
  onNodeDblClick,
  onNodeContextMenu,
  onNodeHover,
  onPortPointerDown,
  onResizePointerDown,
  onEdgeClick,
  onEdgeContextMenu,
  onNotePointerDown,
  onNoteDblClick,
  onNoteContextMenu,
  onNoteResizePointerDown,
  frozen = false,
}: {
  scene: DiagramScene;
  /** Prefix for the arrow markers, so two canvases on one page do not share an id. */
  markerId?: string | undefined;
  /** Wrap each node in `<a>`, preserving the read-only DOM contract (`a > g > g`). */
  linkNodes?: boolean | undefined;
  /** Auto-layout is writing positions; node and resize cursors become `wait`. */
  busy?: boolean | undefined;
  onNodePointerDown?:
    | ((event: MouseEvent, index: number) => void)
    | undefined;
  onNodeClick?: ((index: number) => void) | undefined;
  onNodeDblClick?: ((event: MouseEvent, index: number) => void) | undefined;
  onNodeContextMenu?:
    | ((event: MouseEvent, index: number) => void)
    | undefined;
  onNodeHover?:
    | ((index: number | null, event?: MouseEvent) => void)
    | undefined;
  onPortPointerDown?:
    | ((
      event: MouseEvent,
      index: number,
      portLabel: string | null,
      worldPoint: { x: number; y: number },
      startSide?: ConnectionSide | undefined,
    ) => void)
    | undefined;
  onResizePointerDown?:
    | ((
      event: MouseEvent,
      index: number,
      handle: ResizeHandle,
    ) => void)
    | undefined;
  onEdgeClick?:
    | ((
      event: MouseEvent,
      edge: { label: string; from: number; to: number },
    ) => void)
    | undefined;
  onEdgeContextMenu?:
    | ((event: MouseEvent, label: string) => void)
    | undefined;
  onNotePointerDown?: ((event: MouseEvent, index: number) => void) | undefined;
  onNoteDblClick?: ((event: MouseEvent, index: number) => void) | undefined;
  onNoteContextMenu?:
    | ((event: MouseEvent, index: number) => void)
    | undefined;
  onNoteResizePointerDown?:
    | ((
      event: MouseEvent,
      index: number,
      handle: ResizeHandle,
    ) => void)
    | undefined;
  /** Ignore hits while a transition is moving nodes out from under the cursor. */
  frozen?: boolean | undefined;
} = $props();

function fade(opacity: number | undefined): number | undefined {
  return opacity !== undefined && opacity < 1 ? opacity : undefined;
}

let selectedMarkerId = $derived(`${markerId}-selected`);
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

let visibleEdges = $derived(
  computeVisibleConnections(scene.edges, (index) => boxesByIndex.get(index)),
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
  {@const portPositions = showConnect && node.ports.length > 0
    ? computePortPositions(node.box.width, node.box.height, node.ports)
    : []}
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
            ? (event) =>
              onResizePointerDown?.(event, node.index, handle.handle)
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
      {#each portPositions as port (port.label)}
        <g
          data-testid="diagram-port"
          transform="translate({port.x}, {port.y})"
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
                  port.label,
                  worldPoint(node, port),
                )
              : undefined}
          >
            <title
              >{port.label} ({port.role}, {port.protocol || "untyped"})</title
            >
          </circle>
          <circle
            r="4"
            fill={portFill(port.role)}
            stroke="var(--color-base-100)"
            stroke-width="1.5"
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
    aria-label={onNodeClick ? detailLabel(node) : undefined}
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
{#each visibleEdges as { conn, a, b, orientation } (conn.id)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <g
  data-testid="diagram-edge"
  opacity={fade(conn.opacity)}
  style:pointer-events={frozen || fade(conn.opacity) !== undefined
      ? "none"
      : undefined}
  class:cursor-pointer={edgeInteractive}
  onclick={onEdgeClick
      ? (event) => onEdgeClick?.(event, conn)
      : undefined}
  oncontextmenu={onEdgeContextMenu
      ? (event) => onEdgeContextMenu?.(event, conn.label)
      : undefined}
>
    {#if edgeInteractive}
      <path
        d={elbowPath(a.x, a.y, b.x, b.y, orientation)}
        stroke="transparent"
        stroke-width="14"
        fill="none"
      />
    {/if}
    <path
      d={elbowPath(a.x, a.y, b.x, b.y, orientation)}
      stroke={conn.selected
        ? "var(--color-primary)"
        : "var(--color-base-content)"}
      stroke-opacity={conn.selected ? 1 : 0.35}
      stroke-width={conn.selected ? 2.5 : 1.5}
      fill="none"
      marker-end="url(#{conn.selected ? selectedMarkerId : markerId})"
      style={edgeInteractive ? undefined : "pointer-events: none"}
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
          ? (event) =>
            onNoteResizePointerDown?.(event, note.index, "top-right")
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
