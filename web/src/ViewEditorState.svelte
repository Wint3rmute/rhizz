<script module lang="ts">

export type EditorState =
  | { type: "idle" }
  | { type: "moving_canvas"; startX: number; startY: number; lastX: number; lastY: number }
  | { type: "zooming" }
  // | { type: "dragging_element"; elementId: string; offsetX: number; offsetY: number }
  // | { type: "adding_element"; query: string; candidateType: string | null };

const editor_state = $state<{ current: EditorState }>({
  current: { type: "idle" },
});

  export function get_editor_state() {
    return editor_state;
  }

  export function switch_state_zooming() {
    editor_state.current = { type: "zooming" }
  }
</script>
