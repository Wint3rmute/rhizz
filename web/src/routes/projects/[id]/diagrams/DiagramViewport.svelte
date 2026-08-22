<script lang="ts">
import type { Snippet } from "svelte";
import {
  clamp_zoom,
  create_editor_state,
  reset_view,
} from "../../../../ViewEditorState.svelte";
import type { Box } from "./geometry";

let {
  stateKey = "DIAGRAM_VIEWPORT",
  bounds = null,
  zoomToFillFraction = 0.85,
  content,
  toolbarExtra,
}: {
  stateKey?: string;
  bounds?: Box | null;
  zoomToFillFraction?: number;
  content?: Snippet;
  toolbarExtra?: Snippet;
} = $props();

let editor_state = $derived.by(() => create_editor_state(stateKey));
let root_svg: SVGElement;

let canvas_width = $state(800);
let canvas_height = $state(600);

type InteractionState =
  | { type: "idle" }
  | { type: "panning"; lastX: number; lastY: number };

let interaction = $state<InteractionState>({ type: "idle" });

export function zoomToFill() {
  if (!bounds || bounds.width === 0 || bounds.height === 0) return;

  const zoomX = (canvas_width * zoomToFillFraction) / bounds.width;
  const zoomY = (canvas_height * zoomToFillFraction) / bounds.height;
  const newZoom = clamp_zoom(Math.min(zoomX, zoomY));

  editor_state.view.zoom = newZoom;
  editor_state.view.x = bounds.x + bounds.width / 2 -
    canvas_width / newZoom / 2;
  editor_state.view.y = bounds.y + bounds.height / 2 -
    canvas_height / newZoom / 2;
}

let hasAutoFilled = false;
$effect(() => {
  if (bounds && !hasAutoFilled && canvas_width > 0 && canvas_height > 0) {
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
    <!-- Transparent hit target for canvas drag -->
    <rect
      fill="transparent"
      x={editor_state.view.x}
      y={editor_state.view.y}
      width={canvas_width / editor_state.view.zoom}
      height={canvas_height / editor_state.view.zoom}
    />

    {@render content?.()}
  </svg>

  <!-- Floating minimal toolbar -->
  <div
    class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-base-100/90 backdrop-blur shadow-lg border border-base-300 text-xs"
  >
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

    {@render toolbarExtra?.()}
  </div>
</div>
