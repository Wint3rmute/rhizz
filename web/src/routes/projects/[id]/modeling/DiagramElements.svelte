<script lang="ts">
// Read-only adapter over DiagramCanvas. Kept so Explore, Inventory, the book
// example, and the embed view do not have to assemble a scene themselves.
// The interactive modeling page builds its own scene and renders
// DiagramCanvas directly.
import DiagramCanvas from "./DiagramCanvas.svelte";
import { buildReadOnlyScene } from "./scene";
import type {
  DiagramStaticAnnotation,
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./types";

let {
  components = [],
  connections = [],
  boxes = {},
  annotations = [],
  markerId = "arrow",
  selected = new Set<number>(),
  linked = new Set<number>(),
  onnodeclick,
  onnodehover,
}: {
  components: DiagramStaticComponent[];
  connections: DiagramStaticConnection[];
  boxes: Record<number, DiagramStaticBox>;
  /** View-level text annotations (absolute canvas positions). */
  annotations?: DiagramStaticAnnotation[];
  markerId?: string;
  /** Component indices to show as selected (drawn with a transparent dotted outline on top). */
  selected?: Set<number>;
  linked?: Set<number>;
  onnodeclick?: ((index: number) => void) | undefined;
  /** Optional hover callback — fired with the component index + mouse event on enter, then with `null` on leave. */
  onnodehover?:
    | ((index: number | null, event?: MouseEvent) => void)
    | undefined;
} = $props();

let scene = $derived(
  buildReadOnlyScene({
    components,
    connections,
    boxes,
    annotations,
    selected,
    linked,
    dimUnlinked: onnodeclick !== undefined,
  }),
);
</script>

<DiagramCanvas
  {scene}
  {markerId}
  linkNodes
  onNodeClick={onnodeclick}
  onNodeHover={onnodehover}
/>
