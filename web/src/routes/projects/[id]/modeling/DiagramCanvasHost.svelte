<script lang="ts">
// Story host only: DiagramCanvas is an SVG fragment, and Storybook needs an
// <svg> around it before the play function can query rendered geometry.
import DiagramCanvas from "./DiagramCanvas.svelte";
import type { DiagramScene } from "./scene";

let {
  scene,
  markerId = "arrow",
  linkNodes = false,
  onNodeClick,
}: {
  scene: DiagramScene;
  markerId?: string | undefined;
  linkNodes?: boolean | undefined;
  onNodeClick?: ((index: number) => void) | undefined;
} = $props();
</script>

<svg width="640" height="240" viewBox="-20 -40 640 240">
  <DiagramCanvas {scene} {markerId} {linkNodes} {onNodeClick} />
</svg>
