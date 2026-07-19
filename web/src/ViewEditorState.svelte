<script module lang="ts">
import persisted from "./Persisted.svelte";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export function clamp_zoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export type ViewEditorState = {
  view: { x: number; y: number; zoom: number };
};

const DEFAULT_VIEW = { x: 0, y: 0, zoom: 1 };

// Creates a fresh, independent pan/zoom view state. Each caller owns its
// own instance rather than sharing one module-level singleton — unlike a
// truly global concern (e.g. KeyboardState.svelte/ThemeState.svelte),
// pan/zoom is inherently per-diagram-view, so a future feature needing
// more than one view on screen at once (split view, a thumbnail preview,
// ...) can create as many independent instances as it needs, each with
// its own (optional) storageKey — unlike a single persisted() call
// (which is inherently a singleton per key), so two instances never
// fight over the same localStorage entry unless a caller deliberately
// reuses the same key.
//
// When `storageKey` is given, delegates to the same persisted() helper
// `checked`/`savedLayout` already use for the rest of the diagram's
// content, rather than re-implementing localStorage load/save here —
// only reshaped so callers keep mutating `state.view.x/y/zoom` directly,
// exactly as before persistence existed.
export function create_editor_state(storageKey?: string): ViewEditorState {
  if (!storageKey) {
    const state = $state<ViewEditorState>({ view: { ...DEFAULT_VIEW } });
    return state;
  }
  const stored = persisted(storageKey, DEFAULT_VIEW);
  return {
    get view() {
      return stored.value;
    },
  };
}

// Resets `state`'s pan/zoom back to the origin, at 1x zoom.
export function reset_view(state: ViewEditorState) {
  state.view.x = 0;
  state.view.y = 0;
  state.view.zoom = 1;
}
</script>
