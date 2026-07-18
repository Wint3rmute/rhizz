<script module lang="ts">
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export function clamp_zoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export type ViewEditorState = {
  view: { x: number; y: number; zoom: number };
};

// Creates a fresh, independent pan/zoom view state. Each caller owns its
// own instance rather than sharing one module-level singleton — unlike a
// truly global concern (e.g. KeyboardState.svelte/ThemeState.svelte),
// pan/zoom is inherently per-diagram-view, so a future feature needing
// more than one view on screen at once (split view, a thumbnail preview,
// ...) can create as many independent instances as it needs.
export function create_editor_state(): ViewEditorState {
  const state = $state<ViewEditorState>({
    view: { x: 0, y: 0, zoom: 1 },
  });
  return state;
}

// Resets `state`'s pan/zoom back to the origin, at 1x zoom.
export function reset_view(state: ViewEditorState) {
  state.view.x = 0;
  state.view.y = 0;
  state.view.zoom = 1;
}
</script>
