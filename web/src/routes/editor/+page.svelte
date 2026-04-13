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

  let checked = $state<Record<string, boolean>>({});
</script>

<div class="flex flex-row flex-1 w-full overflow-hidden">
  <!-- Main canvas -->
  <div class="flex flex-col flex-1 min-w-0">
    <button onclick={switch_state_zooming} class="btn btn-primary btn-sm m-2 self-start">
      New
    </button>

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
        <circle cx="10" cy="10" r="2" fill="white" fill-opacity="0.5" />
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

    {#each components.filter((c) => checked[c.label]) as component, i}
      {@render ViewNode(component.label, (i % 5) * 150, Math.floor(i / 5) * 150)}
    {/each}
      </svg>
    </div>
  </div>

  <!-- Right sidebar: component list -->
  <aside class="w-64 shrink-0 bg-gray-900 text-gray-100 p-4 overflow-y-auto border-l border-gray-700">
    <h3 class="font-semibold text-sm mb-3 text-gray-300 uppercase tracking-wide">Components</h3>

    {#if components.length === 0}
      <p class="text-gray-500 text-sm">No components found.<br />Open the editor and define some systems.</p>
    {:else}
      <ul class="space-y-1">
        {#each components as component}
          <li class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              id="comp-{component.label}"
              class="checkbox checkbox-xs"
              bind:checked={checked[component.label]}
            />
            <label for="comp-{component.label}" class="cursor-pointer truncate" title={component.label}>
              {#if !component.leaf}
                <span class="text-gray-400 mr-1">▸</span>
              {/if}
              {component.label}
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
</div>
