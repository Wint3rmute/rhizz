<script lang="ts">
// The floating toolbar at the bottom-centre of the diagrams canvas.
// Deliberately has zero dependency on ViewEditorState/KeyboardState/
// Persisted.svelte — every bit of state it needs is passed in as a prop
// (bindable where the toolbar itself can change it) and every action is
// a callback prop, so it can be rendered standalone (e.g. in a Storybook
// story) without any of +page.svelte's canvas/persistence machinery.
interface Props {
  /** Whether "Snap to Grid" is toggled on. */
  snapEnabled: boolean;
  /** Whether snapping is actually in effect right now (toggle OR a live modifier-key override) — purely for the button's highlighted state. */
  snapActive: boolean;
  /** Currently selected snap grid size, in world units. */
  snapGridSize: number;
  /** Choices offered by the snap grid size dropdown. */
  snapGridSizeOptions: readonly number[];
  /** Whether the background grid is drawn. */
  gridVisible: boolean;
  /** Whether an auto-layout pass is currently running (disables/pulses the button). */
  autoLayoutRunning: boolean;
  onautolayout: () => void;
  onzoomtofill: () => void;
  onresetview: () => void;
}

let {
  snapEnabled = $bindable(),
  snapActive,
  snapGridSize = $bindable(),
  snapGridSizeOptions,
  gridVisible = $bindable(),
  autoLayoutRunning,
  onautolayout,
  onzoomtofill,
  onresetview,
}: Props = $props();
</script>

<div
  class="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-base-100 border border-base-300 rounded-box shadow-lg p-2"
>
  <div class="join">
    <button
      onclick={() => (snapEnabled = !snapEnabled)}
      class="btn btn-sm join-item {snapActive ? 'btn-primary' : 'btn-ghost'}"
      title="Snap dragging/resizing to a {snapGridSize}-unit grid — or hold Ctrl/Cmd to snap temporarily"
    >
      Snap to Grid
    </button>
    <select
      bind:value={snapGridSize}
      class="select select-sm join-item w-20"
      title="Snap grid size, in world units"
    >
      {#each snapGridSizeOptions as option (option)}
        <option value={option}>{option}</option>
      {/each}
    </select>
  </div>
  <button
    onclick={onautolayout}
    disabled={autoLayoutRunning}
    class="btn btn-ghost btn-sm {autoLayoutRunning ? 'animate-pulse' : ''}"
    style="cursor: {autoLayoutRunning ? 'wait' : 'pointer'}"
    title="Auto-arrange the selection (or all top-level nodes, if nothing is selected) using force-directed layout"
  >
    Auto Layout
  </button>
  <button
    onclick={() => (gridVisible = !gridVisible)}
    class="btn btn-sm {gridVisible ? 'btn-ghost' : 'btn-primary'}"
    title="Toggle background grid visibility - nice for screenshots"
  >
    Toggle Grid
  </button>
  <button
    onclick={onzoomtofill}
    class="btn btn-ghost btn-sm"
    title="Zoom and pan to fit the whole diagram - useful for screenshots"
  >
    Zoom to Fill
  </button>
  <button
    onclick={onresetview}
    class="btn btn-ghost btn-sm"
    title="Reset pan and zoom. Useful when you get lost in the diagram"
  >
    Reset View
  </button>
</div>
