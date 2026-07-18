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

  let input = persisted("SYSTEM_INPUT_BOX", "# Your input goes here");
  let output = $derived.by(() =>
    compile_system([{ filename: "all.hcl", content: input.value }])
  );
  let model = $derived(output.model());
  let components = $derived(model ? model.components() : []);
  let connections = $derived(model ? model.connections() : []);

  // Stores position of each checked element. If an element is unchecked, it's not present here
  let checked = $state<Record<string, { x: number; y: number }>>({});

  // Node-drag state
  let dragging: { label: string; offsetX: number; offsetY: number } | null =
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

  function onNodeMouseDown(event: MouseEvent, label: string) {
    event.preventDefault();
    const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
    const pos = checked[label] ?? { x: 0, y: 0 };
    dragging = {
      label,
      offsetX: svgCoords.x - pos.x,
      offsetY: svgCoords.y - pos.y,
    };
  }

  function onCanvasMouseDown(event: MouseEvent) {
    panning = { lastX: event.clientX, lastY: event.clientY };
  }

  function onSvgMouseMove(event: MouseEvent) {
    if (dragging) {
      const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
      checked[dragging.label] = {
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

  // Returns the centre point of a node given its top-left position.
  function nodeCenter(label: string): { x: number; y: number } | null {
    const pos = checked[label];
    if (!pos) return null;
    return { x: pos.x + 50, y: pos.y + 50 };
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
  let visibleConnections = $derived(
    connections.flatMap((conn) => {
      const from = model?.component_by_id(conn.from);
      const to = model?.component_by_id(conn.to);
      if (!from || !to) return [];
      const a = nodeCenter(from.label);
      const b = nodeCenter(to.label);
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
          <pattern id="Pattern" x="0" y="0" width=".1" height=".1">
            <circle
              cx="10"
              cy="10"
              r="2"
              fill="white"
              fill-opacity="0.5"
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
          fill="url(#Pattern)"
          stroke="black"
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
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

        {#snippet ViewNode(name: string, x: number, y: number)}
          <g
            transform="translate({x}, {y})"
            onmousedown={(e) => onNodeMouseDown(e, name)}
            style="cursor: grab"
          >
            <rect
              width="100"
              height="100"
              rx="5"
              stroke="white"
              fill="transparent"
            />
            <text
              x={50}
              y={50}
              fill="white"
              text-anchor="middle"
              dominant-baseline="middle"
              style="pointer-events: none; user-select: none"
            >
              {name}
            </text>
          </g>
        {/snippet}

        {#each components.filter((c) => checked[c.label]) as component}
          {@render ViewNode(
            component.label,
            checked[component.label]?.x ?? 0,
            checked[component.label]?.y ?? 0,
          )}
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
        {#each components as component}
          <li class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              id="comp-{component.label}"
              class="checkbox checkbox-xs"
              onchange={(value) => {
                if (value.currentTarget.checked) {
                  checked[component.label] = {
                    x: 100,
                    y: 100,
                  };
                } else {
                  delete checked[component.label];
                }
              }}
            />
            <label
              for="comp-{component.label}"
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
