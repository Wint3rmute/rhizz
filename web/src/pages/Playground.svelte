<script lang="ts">
  import { onMount } from "svelte";
  import SvgRect from "./SvgRect.svelte";

  let state: "normal" | "dragging" | "dragging_element" | "drawing_path" = $state("normal");

  let path_start: string | null = null;
  let path_end_x: number | null = null;
  let path_end_y: number | null = null;

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
    state = "dragging";
  }

  function mouse_up() {
    state = "normal";
  }

  function mouse_move(event: MouseEvent) {
    if (state == "dragging") {
        viewBoxX -= event.movementX;
        viewBoxY -= event.movementY;
    } else if (state == "drawing_path") {
        path_end_x = event.clientX;
        path_end_y = event.clientY;
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

  function handle_clicked_on_component(id: string) {
    state = "drawing_path";
    path_start = id;
  }

</script>

<div class="h-screen w-screen flex flex-col">
  <div class="navbar bg-base-200">
    <a href="#/" class="btn btn-ghost text-xl">← rhizz</a>
    <span class="ml-2 text-sm opacity-60">Three.js Playground. State: {state}</span>
  </div>
  <div class="flex-1 w-full bg-[#0a0a14]">

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svg version="1.1"
     width="1000" height="600"
     xmlns="http://www.w3.org/2000/svg"
     onmousedown={mouse_down}
     onmouseup={mouse_up}
     onmousemove={mouse_move}
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
        <path
        d="M { elements_dict[path.from].x + 70} {elements_dict[path.from].y + 40} L {elements_dict[path.to].x + 70} {elements_dict[path.to].y + 40}"
        stroke="white"
        fill="transparent"
    {/each}

    {#if state == "drawing_path"}
        <path
        d="M { elements_dict[path_start].x + 70} {elements_dict[path_start].y + 40} L {path_end_x} {path_end_y}"
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
