<script lang="ts">
  import {
    get_editor_state,
    switch_state_zooming,
  } from "../ViewEditorState.svelte";

  const editor_state = get_editor_state();
  let root_svg: SVGElement;
</script>

<button onclick={switch_state_zooming} class="btn btn-primary btn-sm">
  New
</button>
{JSON.stringify(editor_state)}

{#snippet ViewNode(name: string, x: number, y: number)}
  <rect {x} {y} width="100" height="100" rx="5" stroke="white" />
  <text
    x={x + 50}
    y={y + 50}
    fill="white"
    text-anchor="middle"
    dominant-baseline="middle"
  >
    {name}
  </text>
{/snippet}

<div class="h-screen w-screen flex flex-col">
  <div class="navbar bg-base-200">
    <a href="#/" class="btn btn-ghost text-xl">← rhizz</a>
    <span class="ml-2 text-sm opacity-60"
    >Three.js Playground. State: state_here</span>
  </div>
  <div class="flex-1 w-full bg-[#0a0a14]">
    <svg
      bind:this={root_svg}
      version="1.1"
      width="1000"
      height="600"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="{editor_state.view_box.x} {editor_state.view_box.y} 600 400"
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
      </defs>
      <rect
        fill="url(#Pattern)"
        stroke="black"
        x="-100%"
        y="-100%"
        width="300%"
        height="300%"
      />

      {@render ViewNode("TestNode", 0, 0)}
      {@render ViewNode("SomeSystem", 100, 200)}
    </svg>
  </div>
</div>
