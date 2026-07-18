<script module lang="ts">
  export type EditorState =
    | { type: "idle" }
    | {
      type: "moving_canvas";
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
    }
    | { type: "zooming" };

  const editor_state = $state<
    { current: EditorState; view_box: { x: number; y: number } }
  >({
    current: { type: "idle" },
    view_box: {
      x: 0,
      y: 0,
    },
  });

  export function get_editor_state() {
    return editor_state;
  }
</script>
