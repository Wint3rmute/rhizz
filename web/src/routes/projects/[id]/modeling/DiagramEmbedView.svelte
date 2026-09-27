<script lang="ts">
import { resolve } from "$app/paths";
import DiagramViewport from "./DiagramViewport.svelte";
import DiagramElements from "./DiagramElements.svelte";
import type { DiagramScene } from "./diagramScene";

let {
  scene,
  projectId = null,
  diagramPath = null,
  selected = new Set<string>(),
  linked = new Set<string>(),
  onnodeclick,
  onnodehover,
}: {
  /** The resolved diagram. */
  scene: DiagramScene;
  projectId?: string | null;
  diagramPath?: string | null;
  /** Node keys drawn with the selection outline. */
  selected?: Set<string>;
  /** Node keys with a linked detail view (dimmed otherwise, click navigates). */
  linked?: Set<string>;
  /** Optional node interaction — wired to drill-down navigation by the embed page. */
  onnodeclick?: ((key: string) => void) | undefined;
  onnodehover?: ((key: string | null, event?: MouseEvent) => void) | undefined;
} = $props();

let fullDiagramUrl = $derived.by(() => {
  if (!projectId) return null;
  const base = resolve("/projects/[id]/modeling", { id: projectId });
  return diagramPath
    ? `${base}?diagram=${encodeURIComponent(diagramPath)}`
    : base;
});
</script>

<DiagramViewport stateKey={undefined} bounds={scene.bounds}
  viewportIdentity={diagramPath}>
  {#snippet content()}
    <DiagramElements
      {scene}
      markerId="embed-arrow"
      {selected}
      {linked}
      {onnodeclick}
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
