<script lang="ts">
  import {
    get_editor_state,
    switch_state_zooming,
  } from "../../ViewEditorState.svelte";
  import { compile_system } from "../../rhizz_wasm_wrapper";
  import persisted from "../../Persisted.svelte";

  const editor_state = get_editor_state();
  let root_svg: SVGElement;

  let input = persisted("SYSTEM_INPUT_BOX", "# Your input goes here");
  let output = $derived.by(() =>
    compile_system([{ filename: "all.hcl", content: input.value }])
  );
  let model = $derived(output.model());
  let components = $derived(model ? model.components() : []);
  let connections = $derived(model ? model.connections() : []);

  // Stores position of each checked element. If an element is unchecked, it's not present here
  let checked = $state<Record<string, { x: number; y: number }>>({});

  // Drag state
  let dragging: { label: string; offsetX: number; offsetY: number } | null =
    $state(null);

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

  function onSvgMouseMove(event: MouseEvent) {
    if (!dragging) return;
    const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
    checked[dragging.label] = {
      x: svgCoords.x - dragging.offsetX,
      y: svgCoords.y - dragging.offsetY,
    };
  }

  function onSvgMouseUp() {
    dragging = null;
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
    <button
      onclick={switch_state_zooming}
      class="btn btn-primary btn-sm m-2 self-start"
    >
      New
    </button>

    <div class="flex-1 w-full bg-[#0a0a14]">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svg
        bind:this={root_svg}
        version="1.1"
        width="1000"
        height="600"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="{editor_state.view_box.x} {editor_state.view_box
                    .y} 600 400"
        onmousemove={onSvgMouseMove}
        onmouseup={onSvgMouseUp}
        onmouseleave={onSvgMouseUp}
        style="cursor: {dragging ? "grabbing" : "default"}"
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
    </div>
  </div>

  <!-- Right sidebar: component list -->
  <aside
    class="w-64 shrink-0 bg-gray-900 text-gray-100 p-4 overflow-y-auto border-l border-gray-700"
  >
    <h3
      class="font-semibold text-sm mb-3 text-gray-300 uppercase tracking-wide"
    >
      Components
    </h3>

    {#if components.length === 0}
      <p class="text-gray-500 text-sm">
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
                <span class="text-gray-400 mr-1">▸</span>
              {/if}
              {component.label}
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    <br />
    <h3
      class="font-semibold text-sm mb-3 text-gray-300 uppercase tracking-wide"
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
