<script lang="ts">
  import { onMount } from "svelte";
  import SvgRect from "./SvgRect.svelte";

  let root_svg: SVGElement;

  let state: "normal" | "dragging" | "dragging_element" | "drawing_path" = $state("normal");

  let path_start: string | null = $state(null);
  let path_end_x: number | null = $state(null);
  let path_end_y: number | null = $state(null);

  let viewBoxX: number = $state(0);
  let viewBoxY: number = $state(0);

  let elements_dict = $state({
    "engine": {x: 10, y: 20},
    "flight-controller": {x: 100, y: 200},
  });

  let paths = $state([
    // {
    //     from: "flight-controller",
    //     to: "engine"
    // }
  ]);

  function mouse_down() {
    if (state == "normal") {
        state = "dragging";
    }
  }

  function mouse_up() {
    if (state == "dragging") {
        state = "normal";
    }
  }

  function mouse_event_to_svg_coords(event: MouseEvent) {
    const point = new DOMPoint(event.clientX, event.clientY);
    const ctm = root_svg.getScreenCTM().inverse();
    return point.matrixTransform(ctm);
  }

  function mouse_move(event: MouseEvent) {
    if (state == "dragging") {
        viewBoxX -= event.movementX;
        viewBoxY -= event.movementY;
    } else if (state == "drawing_path") {
        const svg_point = mouse_event_to_svg_coords(event);
        path_end_x = svg_point.x;
        path_end_y = svg_point.y;
    }
  }

  function mouse_down_on_component() {
    state = "dragging_element";
  }

  function mouse_up_on_component() {
    state = "normal";
  }

  function mouse_move_on_component(id: string, event: MouseEvent) {
    if (state != "dragging_element") {
        return;
    }

    elements_dict[id].x += event.movementX;
    elements_dict[id].y += event.movementY;
  }

  function on_key_down(event: KeyboardEvent) {
    if (event.key != "Escape") {
      return;
    }
    state = "normal";
  }

  function handle_clicked_on_component(id: string, event: MouseEvent) {
    event.stopPropagation();

    if (state == "normal") {
        path_start = id;
        const svg_point = mouse_event_to_svg_coords(event);
        path_end_x = svg_point.x;
        path_end_y = svg_point.y;
        state = "drawing_path";
    } else if (state == "drawing_path") {
        paths.push({
            from: "flight-controller",
            to: "engine"
        });
        state = "normal";
    }
  }

  function on_wheel(event: WheelEvent) {
    event.preventDefault();
    event.stopPropagation();

    viewBoxX += event.deltaX;
    viewBoxY += event.deltaY;
  }

</script>

<div class="h-screen w-screen flex flex-col">
  <div class="navbar bg-base-200">
    <a href="#/" class="btn btn-ghost text-xl">← rhizz</a>
    <span class="ml-2 text-sm opacity-60">Three.js Playground. State: {state}</span>
  </div>
  <div class="flex-1 w-full bg-[#0a0a14]">

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svg 
    bind:this={root_svg}
    version="1.1"
    width="1000" height="600"
    xmlns="http://www.w3.org/2000/svg"
    onmousedown={mouse_down}
    onmouseup={mouse_up}
    onmousemove={mouse_move}
    onwheel={on_wheel}
    viewBox="{viewBoxX} {viewBoxY} 600 400"
     >
  <defs>
    <pattern id="Pattern" x="0" y="0" width=".1" height=".1">
      <circle
        cx="10"
        cy="10"
        r="2"
        fill="white"
        fill-opacity="0.5" />
    </pattern>
  </defs>
  <rect fill="url(#Pattern)" stroke="black" x="-100%" y="-100%" width="300%" height="300%" />
  	{#each paths as path}
    <line
        x1="{elements_dict[path.from].x + 70}"
        y1="{elements_dict[path.from].y + 40}"
        x2="{elements_dict[path.to].x + 70}"
        y2="{elements_dict[path.to].y + 40}"
        stroke="white"
    />

    {/each}

    {#if state == "drawing_path" && path_start !== null}
        <line
        x1="{ elements_dict[path_start].x + 70}"
        y1="{elements_dict[path_start].y + 40}"
        x2="{path_end_x}"
        y2="{path_end_y}"
        stroke="white"
        fill="transparent"
    />
    {/if}

  	{#each Object.entries(elements_dict) as element}
        <SvgRect
            id={element[0]} 
            x={element[1].x} 
            y={element[1].y} 
            mouse_down_handler={mouse_down_on_component} 
            mouse_up_handler={mouse_up_on_component}
            mouse_move_handler={mouse_move_on_component}
            handle_clicked_on_component={handle_clicked_on_component}
            />
	{/each}
</svg>

  </div>
</div>

<svelte:window onkeydown={on_key_down} />

