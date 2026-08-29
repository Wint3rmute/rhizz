<script lang="ts">
// A read-only, non-interactive rendering of a diagram's placed nodes and
// connections — a smaller, first-cut extraction of +page.svelte's canvas
// rendering, deliberately stripped of everything that makes the real
// canvas heavy to mount standalone: no drag/resize/marquee/pan/zoom
// interaction, no undo history, no auto-layout, and critically, no
// dependency on rhizz_wasm_wrapper/"rhizz" at all.
import { unionBox } from "./geometry";
import DiagramElements from "./DiagramElements.svelte";
import type {
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./types";

let {
  components = [],
  connections = [],
  boxes = {},
  padding = 40,
  selected = new Set<number>(),
  linked = new Set<number>(),
  onnodeclick,
}: {
  /** Indexed the same way `connections[].from`/`.to` and `boxes`' keys are — i.e. this is expected to be the *full* component list, not just the placed ones. */
  components: DiagramStaticComponent[];
  connections: DiagramStaticConnection[];
  /** Which components are actually placed on the canvas, and where — keyed by index into `components`. A component with no entry here simply isn't rendered. */
  boxes: Record<number, DiagramStaticBox>;
  /** Empty space (world units) left around the content's bounding box in the auto-fit viewBox. */
  padding?: number;
  /** Component indices to show as selected (drawn with a transparent dotted outline on top). */
  selected?: Set<number>;
  /** Component indices with a linked detail view; used only for interactive affordance. */
  linked?: Set<number>;
  /** Optional node interaction. Omitted for the normal read-only renderer. */
  onnodeclick?: ((index: number) => void) | undefined;
} = $props();

// Auto-fits the viewBox to whatever's actually placed, rather than
// requiring a caller-managed pan/zoom state (there's no interaction here
// to drive one) — makes this genuinely a one-prop-in, rendered-diagram-out
// component, ideal for a Storybook thumbnail.
let viewBox = $derived.by(() => {
  const placed = Object.values(boxes);
  if (placed.length === 0) return "0 0 100 100";
  const bounds = unionBox(placed);
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
  viewBox={viewBox}
>
  <DiagramElements
    {components}
    {connections}
    {boxes}
    {selected}
    {linked}
    {onnodeclick}
  />
</svg>
