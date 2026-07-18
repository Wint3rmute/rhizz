<script module lang="ts">
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export function clamp_zoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

const editor_state = $state<{
  view: { x: number; y: number; zoom: number };
}>({
  view: { x: 0, y: 0, zoom: 1 },
});

export function get_editor_state() {
  return editor_state;
}

export function reset_view() {
  editor_state.view.x = 0;
  editor_state.view.y = 0;
  editor_state.view.zoom = 1;
}
</script>
