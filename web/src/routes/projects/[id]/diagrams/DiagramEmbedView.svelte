<script lang="ts">
import { resolve } from "$app/paths";
import DiagramViewport from "./DiagramViewport.svelte";
import DiagramElements from "./DiagramElements.svelte";
import { unionBox } from "./geometry";
import type {
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./types";

let {
  components = [],
  connections = [],
  boxes = {},
  projectId = null,
  diagramPath = null,
  selected = new Set<number>(),
  onnodehover,
}: {
  components: DiagramStaticComponent[];
  connections: DiagramStaticConnection[];
  boxes: Record<number, DiagramStaticBox>;
  projectId?: string | null;
  diagramPath?: string | null;
  /** Component indices to show as selected (drawn with a transparent dotted outline on top). */
  selected?: Set<number>;
  /** Optional hover callback — fired with the component index + mouse event on enter, then with `null` on leave. */
  onnodehover?:
    | ((index: number | null, event?: MouseEvent) => void)
    | undefined;
} = $props();

let bounds = $derived.by(() => {
  const placed = Object.values(boxes);
  if (placed.length === 0) return null;
  return unionBox(placed);
});

let fullDiagramUrl = $derived.by(() => {
  if (!projectId) return null;
  const base = resolve("/projects/[id]/diagrams", { id: projectId });
  return diagramPath
    ? `${base}?diagram=${encodeURIComponent(diagramPath)}`
    : base;
});
</script>

<DiagramViewport stateKey="DIAGRAM_EMBED" {bounds}>
  {#snippet content()}
    <DiagramElements
      {components}
      {connections}
      {boxes}
      markerId="embed-arrow"
      {selected}
      {onnodehover}
    />
  {/snippet}

  {#snippet toolbarExtra()}
    {#if fullDiagramUrl}
      <div class="h-3.5 w-px bg-base-300 mx-0.5"></div>
      <a
        href={fullDiagramUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-primary btn-xs rounded-full px-2.5 font-medium flex items-center gap-1"
        title="Open full interactive diagram in Rhizz"
      >
        <span>Open in Rhizz</span>
        <span aria-hidden="true">↗</span>
      </a>
    {/if}
  {/snippet}
</DiagramViewport>
