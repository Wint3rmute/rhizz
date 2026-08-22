<script lang="ts">
import { resolve } from "$app/paths";
import {
  clamp_zoom,
  create_editor_state,
  reset_view,
} from "../../../../ViewEditorState.svelte";
import {
  type Box,
  computeRenderOrder,
  computeVisibleConnections,
  elbowPath,
  type TextAlign,
  textPosition,
  unionBox,
} from "./geometry";
import type {
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./DiagramStaticView.svelte";

let {
  components = [],
  connections = [],
  boxes = {},
  projectId = null,
  diagramPath = null,
}: {
  components: DiagramStaticComponent[];
  connections: DiagramStaticConnection[];
  boxes: Record<number, DiagramStaticBox>;
  projectId?: string | null;
  diagramPath?: string | null;
} = $props();

const editor_state = create_editor_state("DIAGRAM_EMBED");
let root_svg: SVGElement;

let canvas_width = $state(800);
let canvas_height = $state(600);

type InteractionState =
  | { type: "idle" }
  | { type: "panning"; lastX: number; lastY: number };

let interaction = $state<InteractionState>({ type: "idle" });

function nodeBox(index: number): (Box & { textAlign: TextAlign }) | null {
  const box = boxes[index];
  if (!box) return null;
  return { ...box, textAlign: box.textAlign ?? "center" };
}

function parentOf(index: number): number | undefined {
  return components[index]?.parent_component_index;
}

// Order nodes shallowest first so parents render behind children.
let renderOrder = $derived(
  computeRenderOrder(Object.keys(boxes).map(Number), parentOf),
);

let visibleConnections = $derived(
  computeVisibleConnections(connections, (i) => nodeBox(i)),
);

const ZOOM_TO_FILL_FRACTION = 0.85;

export function zoomToFill() {
  const placed = renderOrder
    .map((index) => nodeBox(index))
    .filter(
      (box): box is NonNullable<ReturnType<typeof nodeBox>> => box !== null,
    );
  if (placed.length === 0) return;
  const bounds = unionBox(placed);

  const zoomX = (canvas_width * ZOOM_TO_FILL_FRACTION) / bounds.width;
  const zoomY = (canvas_height * ZOOM_TO_FILL_FRACTION) / bounds.height;
  const newZoom = clamp_zoom(Math.min(zoomX, zoomY));

  editor_state.view.zoom = newZoom;
  editor_state.view.x = bounds.x + bounds.width / 2 -
    canvas_width / newZoom / 2;
  editor_state.view.y = bounds.y + bounds.height / 2 -
    canvas_height / newZoom / 2;
}

// Automatically zoom to fill on initial mount or when boxes change
let hasAutoFilled = false;
$effect(() => {
  if (renderOrder.length > 0 && !hasAutoFilled && canvas_width > 0) {
    hasAutoFilled = true;
    zoomToFill();
  }
});

function onCanvasMouseDown(event: MouseEvent) {
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault();
  interaction = {
    type: "panning",
    lastX: event.clientX,
    lastY: event.clientY,
  };
}

function onSvgMouseMove(event: MouseEvent) {
  if (interaction.type === "panning") {
    const dx = (event.clientX - interaction.lastX) / editor_state.view.zoom;
    const dy = (event.clientY - interaction.lastY) / editor_state.view.zoom;
    editor_state.view.x -= dx;
    editor_state.view.y -= dy;
    interaction = {
      type: "panning",
      lastX: event.clientX,
      lastY: event.clientY,
    };
  }
}

function onSvgMouseUp() {
  interaction = { type: "idle" };
}

function onWheel(event: WheelEvent) {
  event.preventDefault();
  const zoom = editor_state.view.zoom;
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newZoom = clamp_zoom(zoom * factor);
  if (newZoom === zoom) return;

  const rect = root_svg.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  const oldWidth = canvas_width / zoom;
  const oldHeight = canvas_height / zoom;
  const fracX = mouseX / canvas_width;
  const fracY = mouseY / canvas_height;

  const newWidth = canvas_width / newZoom;
  const newHeight = canvas_height / newZoom;

  editor_state.view.zoom = newZoom;
  editor_state.view.x += (oldWidth - newWidth) * fracX;
  editor_state.view.y += (oldHeight - newHeight) * fracY;
}

// Touch gesture support for mobile embed
let touchStartDist: number | null = null;
let lastTouchX = 0;
let lastTouchY = 0;

function onTouchStart(event: TouchEvent) {
  if (event.touches.length === 1) {
    lastTouchX = event.touches[0].clientX;
    lastTouchY = event.touches[0].clientY;
  } else if (event.touches.length === 2) {
    const dx = event.touches[0].clientX - event.touches[1].clientX;
    const dy = event.touches[0].clientY - event.touches[1].clientY;
    touchStartDist = Math.hypot(dx, dy);
  }
}

function onTouchMove(event: TouchEvent) {
  event.preventDefault();
  if (event.touches.length === 1) {
    const dx = (event.touches[0].clientX - lastTouchX) /
      editor_state.view.zoom;
    const dy = (event.touches[0].clientY - lastTouchY) /
      editor_state.view.zoom;
    editor_state.view.x -= dx;
    editor_state.view.y -= dy;
    lastTouchX = event.touches[0].clientX;
    lastTouchY = event.touches[0].clientY;
  } else if (event.touches.length === 2 && touchStartDist !== null) {
    const dx = event.touches[0].clientX - event.touches[1].clientX;
    const dy = event.touches[0].clientY - event.touches[1].clientY;
    const newDist = Math.hypot(dx, dy);
    const factor = newDist / touchStartDist;
    editor_state.view.zoom = clamp_zoom(editor_state.view.zoom * factor);
    touchStartDist = newDist;
  }
}

function onTouchEnd() {
  touchStartDist = null;
}

let fullDiagramUrl = $derived.by(() => {
  if (!projectId) return null;
  const base = resolve("/projects/[id]/diagrams", { id: projectId });
  return diagramPath
    ? `${base}?diagram=${encodeURIComponent(diagramPath)}`
    : base;
});
</script>

<div
  class="relative flex-1 w-full h-full bg-base-300 select-none overflow-hidden"
  bind:clientWidth={canvas_width}
  bind:clientHeight={canvas_height}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <svg
    bind:this={root_svg}
    version="1.1"
    width="100%"
    height="100%"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="{editor_state.view.x} {editor_state.view.y} {canvas_width / editor_state.view.zoom} {canvas_height / editor_state.view.zoom}"
    onmousedown={onCanvasMouseDown}
    onmousemove={onSvgMouseMove}
    onmouseup={onSvgMouseUp}
    onmouseleave={onSvgMouseUp}
    onwheel={onWheel}
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
    style="cursor: {interaction.type === 'panning' ? 'grabbing' : 'grab'}"
  >
    <defs>
      <marker
        id="embed-arrow"
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
    </defs>

    <!-- Transparent hit target for canvas drag -->
    <rect
      fill="transparent"
      x={editor_state.view.x}
      y={editor_state.view.y}
      width={canvas_width / editor_state.view.zoom}
      height={canvas_height / editor_state.view.zoom}
    />

    <!-- Render placed nodes -->
    {#each renderOrder as index (index)}
      {@const box = nodeBox(index)}
      {@const component = components[index]}
      {#if box && component}
        {@const textPos = textPosition(box.textAlign, box.width, box.height)}
        <g transform="translate({box.x}, {box.y})">
          <rect
            width={box.width}
            height={box.height}
            rx="5"
            stroke="var(--color-base-content)"
            stroke-width="1"
            fill="var(--color-base-200)"
          />
          <text
            x={textPos.x}
            y={textPos.y}
            fill="var(--color-base-content)"
            text-anchor={textPos.anchor}
            dominant-baseline={textPos.baseline}
            style="pointer-events: none; user-select: none"
          >
            {component.label}
          </text>
        </g>
      {/if}
    {/each}

    <!-- Render connections on top -->
    {#each visibleConnections as { conn, a, b, orientation } (`${conn.label}-${conn.from}-${conn.to}`)}
      <path
        d={elbowPath(a.x, a.y, b.x, b.y, orientation)}
        stroke="var(--color-base-content)"
        stroke-opacity="0.35"
        stroke-width="1.5"
        fill="none"
        marker-end="url(#embed-arrow)"
        style="pointer-events: none"
      />
      <text
        x={(a.x + b.x) / 2}
        y={(a.y + b.y) / 2 - 6}
        fill="var(--color-base-content)"
        fill-opacity="0.5"
        font-size="10"
        text-anchor="middle"
        style="pointer-events: none; user-select: none"
      >
        {conn.label}
      </text>
    {/each}
  </svg>

  <!-- Minimal floating embed toolbar -->
  <div
    class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-base-100/90 backdrop-blur shadow-lg border border-base-300 text-xs">
    <button
      type="button"
      class="btn btn-ghost btn-xs rounded-full px-2"
      onclick={zoomToFill}
      title="Zoom to fill (fit content in view)"
    >
      ⛶ Fit
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs rounded-full px-2"
      onclick={() => reset_view(editor_state)}
      title="Reset view (100% zoom)"
    >
      ↺ Reset
    </button>
    <span class="text-base-content/60 font-mono px-1">
      {Math.round(editor_state.view.zoom * 100)}%
    </span>

    {#if fullDiagramUrl}
      <div class="h-3.5 w-px bg-base-300 mx-0.5"></div>
      <a
        href={fullDiagramUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-primary btn-xs rounded-full px-2.5 font-medium flex items-center gap-1"
        title="Open full interactive diagram in Rhizz"
      >
        <span>Open in Rhizz</span>
        <span aria-hidden="true">↗</span>
      </a>
    {/if}
  </div>
</div>
