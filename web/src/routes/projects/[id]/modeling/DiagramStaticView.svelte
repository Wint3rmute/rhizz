<script lang="ts">
// A read-only rendering of a diagram: one `<svg>` whose viewBox auto-fits the
// scene's bounds. It owns no pan/zoom state (there is no interaction here to
// drive one), which makes it a one-prop-in, rendered-diagram-out component —
// ideal for a Storybook thumbnail, an Inventory preview, or the book.
import DiagramElements from "./DiagramElements.svelte";
import type { DiagramScene } from "./diagramScene";

let {
  scene,
  padding = 40,
  selected = new Set<string>(),
  linked = new Set<string>(),
  onnodeclick,
  onnodehover,
}: {
  /** The resolved diagram. */
  scene: DiagramScene;
  /** Empty space (world units) left around the content's bounding box. */
  padding?: number;
  /** Node keys drawn with the selection outline. */
  selected?: Set<string>;
  /** Node keys with a detail view; used only for interactive affordance. */
  linked?: Set<string>;
  onnodeclick?: ((key: string) => void) | undefined;
  onnodehover?: ((key: string | null, event?: MouseEvent) => void) | undefined;
} = $props();

// Auto-fits to whatever is actually placed — including annotations at
// far-away absolute positions — so a note is never clipped out of frame.
let viewBox = $derived.by(() => {
  const bounds = scene.bounds;
  if (bounds === null) return "0 0 100 100";
  return `${bounds.x - padding} ${bounds.y - padding} ${
    bounds.width + padding * 2
  } ${bounds.height + padding * 2}`;
});
</script>

<svg
  version="1.1"
  width="100%"
  height="100%"
  xmlns="http://www.w3.org/2000/svg"
  {viewBox}
>
  <DiagramElements
    {scene}
    {selected}
    {linked}
    {onnodeclick}
    {onnodehover}
  />
</svg>
