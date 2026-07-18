<script lang="ts">
import {
  clamp_zoom,
  get_editor_state,
  reset_view,
} from "../../ViewEditorState.svelte";
import { compile_system } from "../../rhizz_wasm_wrapper";
import persisted from "../../Persisted.svelte";

const editor_state = get_editor_state();
let root_svg: SVGElement;

// Tracks the canvas's rendered pixel size so the SVG viewBox can match it
// exactly (1 SVG unit == 1 pixel), keeping the canvas filling all
// available space with no letterboxing regardless of viewport size.
let canvas_width = $state(800);
let canvas_height = $state(600);

// Background grid spacing, in world (SVG) units. MAJOR_GRID_SPACING
// matches the node size (100x100), so the grid doubles as a snapping
// guide; MINOR_GRID_SPACING subdivides each major cell into tenths.
//
// TODO: spacing is fixed, so at extreme zoom the grid can get too dense
// (zoomed out) or too sparse (zoomed in). If that becomes an issue, make
// spacing adaptive: derive a multiplier from editor_state.view.zoom,
// snapped to a "nice" progression (1, 2, 5, 10, 20, 50, ...) so that
// MINOR_GRID_SPACING * zoom stays within a target pixel range (e.g.
// 8-40px), and feed the result into the pattern's width/height and the
// minorGridLines offsets below instead of the constants.
const MAJOR_GRID_SPACING = 100;
const MINOR_GRID_SPACING = 10;
const minorGridLines = Array.from(
  { length: MAJOR_GRID_SPACING / MINOR_GRID_SPACING - 1 },
  (_, i) => (i + 1) * MINOR_GRID_SPACING,
);

let input = persisted("SYSTEM_INPUT_BOX", "# Your input goes here");
let output = $derived.by(() =>
  compile_system([{ filename: "all.hcl", content: input.value }])
);
let model = $derived(output.model());
let components = $derived(model ? model.components() : []);
let connections = $derived(model ? model.connections() : []);

// Default node size, in world (SVG) units, for newly-placed nodes and for
// backfilling entries persisted before per-node sizing existed.
const DEFAULT_NODE_WIDTH = 100;
const DEFAULT_NODE_HEIGHT = 100;

// Stores position + size of each checked element, keyed by the component's
// arena index (its position in model.components(), same index space as
// ConnectionJS.from/to and ComponentJS.parent_component_index). Component
// labels are only unique within a parent scope (SPEC.md §2.3), so labels
// cannot be used as a stable key once components are nested. If an element
// is unchecked, it's not present here. Persisted so the diagram layout
// survives page reloads. width/height are optional in storage so entries
// persisted before node sizing existed still parse; see nodeBox() for the
// backfilled read path.
let checked = persisted<
  Record<number, { x: number; y: number; width?: number; height?: number }>
>("DIAGRAM_CHECKED_NODES", {});

// Returns the placed node's box (position + size), or null if the component
// isn't currently checked. Backfills width/height with defaults for entries
// persisted before node sizing was introduced.
function nodeBox(
  index: number,
): { x: number; y: number; width: number; height: number } | null {
  const pos = checked.value[index];
  if (!pos) return null;
  return {
    x: pos.x,
    y: pos.y,
    width: pos.width ?? DEFAULT_NODE_WIDTH,
    height: pos.height ?? DEFAULT_NODE_HEIGHT,
  };
}

// Currently selected node (component arena index), or null if nothing is
// selected. Not persisted — selection is a transient UI state.
let selected: number | null = $state(null);

// Node-drag state
let dragging: { index: number; offsetX: number; offsetY: number } | null =
  $state(null);

// Canvas-pan state (screen-space pointer position of the last move event)
let panning: { lastX: number; lastY: number } | null = $state(null);

function svgPoint(
  svg: SVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const pt = (svg as SVGSVGElement).createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = (svg as SVGSVGElement).getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

function onNodeMouseDown(event: MouseEvent, index: number) {
  event.preventDefault();
  selected = index;
  const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
  const pos = checked.value[index] ?? { x: 0, y: 0 };
  dragging = {
    index,
    offsetX: svgCoords.x - pos.x,
    offsetY: svgCoords.y - pos.y,
  };
}

function onCanvasMouseDown(event: MouseEvent) {
  selected = null;
  panning = { lastX: event.clientX, lastY: event.clientY };
}

function onSvgMouseMove(event: MouseEvent) {
  if (dragging) {
    const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
    checked.value[dragging.index] = {
      x: svgCoords.x - dragging.offsetX,
      y: svgCoords.y - dragging.offsetY,
    };
    return;
  }
  if (panning) {
    const dxScreen = event.clientX - panning.lastX;
    const dyScreen = event.clientY - panning.lastY;
    const zoom = editor_state.view.zoom;
    editor_state.view.x -= dxScreen / zoom;
    editor_state.view.y -= dyScreen / zoom;
    panning = { lastX: event.clientX, lastY: event.clientY };
  }
}

function onSvgMouseUp() {
  dragging = null;
  panning = null;
}

// Zooms in/out on the mouse wheel, keeping the point under the cursor
// visually fixed while the rest of the canvas scales around it.
function onWheel(event: WheelEvent) {
  event.preventDefault();
  const zoom = editor_state.view.zoom;
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newZoom = clamp_zoom(zoom * factor);
  if (newZoom === zoom) return;

  const mouseSvg = svgPoint(root_svg, event.clientX, event.clientY);
  const oldWidth = canvas_width / zoom;
  const oldHeight = canvas_height / zoom;
  const fracX = (mouseSvg.x - editor_state.view.x) / oldWidth;
  const fracY = (mouseSvg.y - editor_state.view.y) / oldHeight;

  const newWidth = canvas_width / newZoom;
  const newHeight = canvas_height / newZoom;

  editor_state.view.zoom = newZoom;
  editor_state.view.x = mouseSvg.x - fracX * newWidth;
  editor_state.view.y = mouseSvg.y - fracY * newHeight;
}

// Returns the centre point of a node given its top-left position and size.
function nodeCenter(index: number): { x: number; y: number } | null {
  const box = nodeBox(index);
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Builds an SVG path string for a Z-shaped elbow route with rounded corners.
function elbowPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r = 10,
): string {
  const dx = bx - ax;
  const dy = by - ay;
  const mx = (ax + bx) / 2;

  if (Math.abs(dy) < 0.5) return `M ${ax},${ay} L ${bx},${by}`;

  const rc = Math.min(r, Math.abs(dx) / 2, Math.abs(dy) / 2);
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  const s1 = dx * dy > 0 ? 1 : 0;
  const s2 = 1 - s1;

  return [
    `M ${ax},${ay}`,
    `L ${mx - sx * rc},${ay}`,
    `A ${rc},${rc} 0 0,${s1} ${mx},${ay + sy * rc}`,
    `L ${mx},${by - sy * rc}`,
    `A ${rc},${rc} 0 0,${s2} ${mx + sx * rc},${by}`,
    `L ${bx},${by}`,
  ].join(" ");
}

// Only connections where both endpoints are currently on the canvas.
// conn.from/conn.to are already component arena indices, matching the same
// index space `checked` is keyed by.
let visibleConnections = $derived(
  connections.flatMap((conn) => {
    const a = nodeCenter(conn.from);
    const b = nodeCenter(conn.to);
    if (!a || !b) return [];
    return [{ conn, a, b }];
  }),
);
</script>

<div class="flex flex-row flex-1 w-full overflow-hidden">
  <!-- Main canvas -->
  <div class="flex flex-col flex-1 min-w-0">
    <div
      class="relative flex-1 w-full h-full bg-neutral"
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
        viewBox="{editor_state.view.x} {editor_state.view
                    .y} {canvas_width / editor_state.view.zoom} {canvas_height /
                    editor_state.view.zoom}"
        onmousemove={onSvgMouseMove}
        onmouseup={onSvgMouseUp}
        onmouseleave={onSvgMouseUp}
        onwheel={onWheel}
        style="cursor: {dragging || panning ? 'grabbing' : 'grab'}"
      >
        <defs>
          <!--
            World-space grid: patternUnits="userSpaceOnUse" ties the tile to
            the same coordinate system as nodes/connections, so it pans and
            zooms for free via the SVG's own viewBox transform — no JS math
            needed. The tile is sized to the major spacing (100 units, same
            as a node) and draws the minor lines inside it plus one bold
            line on its own edge, which tiles seamlessly into the major grid.
          -->
          <pattern
            id="Grid"
            width={MAJOR_GRID_SPACING}
            height={MAJOR_GRID_SPACING}
            patternUnits="userSpaceOnUse"
          >
            {#each minorGridLines as i}
              <line
                x1={i}
                y1="0"
                x2={i}
                y2={MAJOR_GRID_SPACING}
                stroke="white"
                stroke-opacity="0.08"
                stroke-width="1"
              />
              <line
                x1="0"
                y1={i}
                x2={MAJOR_GRID_SPACING}
                y2={i}
                stroke="white"
                stroke-opacity="0.08"
                stroke-width="1"
              />
            {/each}
            <line
              x1="0"
              y1="0"
              x2={MAJOR_GRID_SPACING}
              y2="0"
              stroke="white"
              stroke-opacity="0.2"
              stroke-width="1"
            />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={MAJOR_GRID_SPACING}
              stroke="white"
              stroke-opacity="0.2"
              stroke-width="1"
            />
          </pattern>
          <marker
            id="arrow"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              fill="white"
              fill-opacity="0.5"
            />
          </marker>
        </defs>
        <rect
          fill="url(#Grid)"
          x={editor_state.view.x}
          y={editor_state.view.y}
          width={canvas_width / editor_state.view.zoom}
          height={canvas_height / editor_state.view.zoom}
          onmousedown={onCanvasMouseDown}
        />

        {#each visibleConnections as { conn, a, b }}
          <path
            d={elbowPath(a.x, a.y, b.x, b.y)}
            stroke="white"
            stroke-opacity="0.35"
            stroke-width="1.5"
            fill="none"
            marker-end="url(#arrow)"
          />
          <text
            x={(a.x + b.x) / 2}
            y={(a.y + b.y) / 2 - 6}
            fill="white"
            fill-opacity="0.5"
            font-size="10"
            text-anchor="middle"
            style="pointer-events: none; user-select: none"
          >
            {conn.label}
          </text>
        {/each}

        {#snippet ViewNode(
          label: string,
          index: number,
          x: number,
          y: number,
          width: number,
          height: number,
        )}
          <g
            transform="translate({x}, {y})"
            onmousedown={(e) => onNodeMouseDown(e, index)}
            style="cursor: grab"
          >
            <rect
              {width}
              {height}
              rx="5"
              stroke={selected === index ? "var(--color-primary)" : "white"}
              stroke-width={selected === index ? 2 : 1}
              fill="var(--color-base-200)"
            />
            <text
              x={width / 2}
              y={height / 2}
              fill="white"
              text-anchor="middle"
              dominant-baseline="middle"
              style="pointer-events: none; user-select: none"
            >
              {label}
            </text>
          </g>
        {/snippet}

        {#each components as component, index}
          {@const box = nodeBox(index)}
          {#if box}
            {@render ViewNode(
              component.label,
              index,
              box.x,
              box.y,
              box.width,
              box.height,
            )}
          {/if}
        {/each}
      </svg>

      <button
        onclick={reset_view}
        class="btn btn-ghost btn-sm absolute bottom-2 right-2 z-10"
        title="Reset pan and zoom"
      >
        Reset View
      </button>
    </div>
  </div>

  <!-- Right sidebar: component list -->
  <aside
    class="w-64 shrink-0 bg-base-100 text-base-content p-4 overflow-y-auto border-l border-base-300"
  >
    <h3
      class="font-semibold text-sm mb-3 text-base-content/70 uppercase tracking-wide"
    >
      Components
    </h3>

    {#if components.length === 0}
      <p class="text-base-content/50 text-sm">
        No components found.<br />Open the editor and define some systems.
      </p>
    {:else}
      <ul class="space-y-1">
        {#each components as component, index}
          <li class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              id="comp-{index}"
              class="checkbox checkbox-xs"
              checked={!!checked.value[index]}
              onchange={(value) => {
                if (value.currentTarget.checked) {
                  checked.value[index] = {
                    x: 100,
                    y: 100,
                    width: DEFAULT_NODE_WIDTH,
                    height: DEFAULT_NODE_HEIGHT,
                  };
                } else {
                  delete checked.value[index];
                  if (selected === index) selected = null;
                }
              }}
            />
            <label
              for="comp-{index}"
              class="cursor-pointer truncate"
              title={component.label}
            >
              {#if !component.leaf}
                <span class="text-base-content/60 mr-1">▸</span>
              {/if}
              {component.label}
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    <br />
    <h3
      class="font-semibold text-sm mb-3 text-base-content/70 uppercase tracking-wide"
    >
      Connections
    </h3>

    <ul class="space-y-1">
      {#each connections as connection}
        <li class="flex items-center gap-2 text-sm">
          {connection.label}
        </li>
      {/each}
    </ul>
  </aside>
</div>
