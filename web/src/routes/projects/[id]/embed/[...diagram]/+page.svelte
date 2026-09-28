<script lang="ts">
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import DiagramEmbedView from "../../modeling/DiagramEmbedView.svelte";
import DiagramViewer from "../../modeling/DiagramViewer.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();

let projectId = $derived(data.projectId);
let rawDiagramParam = $derived(data.diagramParam);

// Normalize diagram filename (e.g. "overview" -> "overview.hcl")
let normalizedDiagramPath = $derived.by(() => {
  if (!rawDiagramParam) return "main.hcl";
  return rawDiagramParam.endsWith(".hcl") || rawDiagramParam.endsWith(".json")
    ? rawDiagramParam
    : `${rawDiagramParam}.hcl`;
});

function openDiagram(path: string): void {
  const base = resolve("/projects/[id]/embed/[...diagram]", {
    id: projectId ?? "",
    diagram: path,
  });
  void goto(base);
}
</script>

<!-- Chromeless takeover like the book embed: covers the root layout's
     navbar so the iframe shows only the diagram. The project layout still
     supplies project loading and the not-found card; it only drops its
     status bar here. Embed is project-scoped (it reads this project's VFS),
     so it lives under /projects/[id] like every other project route — but
     it is not an *endpoint* beside code/explore/inventory, which is why it
     has no navbar entry of its own. -->
<div
  class="fixed inset-0 z-40 w-screen h-screen bg-base-300 flex flex-col overflow-hidden"
>
  <DiagramViewer
    {projectId}
    diagramPath={normalizedDiagramPath}
    onOpenDiagram={openDiagram}
  >
    {#snippet pending()}
      <div class="flex-1 flex items-center justify-center text-sm text-base-content/60">
        Loading diagram…
      </div>
    {/snippet}
    {#snippet whenEmpty()}
      <div class="flex-1 flex items-center justify-center text-sm text-base-content/60 p-4 text-center">
        Diagram "{normalizedDiagramPath}" has no placed components or annotations.
      </div>
    {/snippet}
    {#snippet children(view)}
      <DiagramEmbedView
        components={view.components}
        connections={view.connections}
        boxes={view.boxes}
        annotations={view.annotations}
        {projectId}
        diagramPath={normalizedDiagramPath}
        linked={view.linked}
        onnodeclick={view.onnodeclick}
        onnodehover={view.onnodehover}
      />
    {/snippet}
  </DiagramViewer>
</div>
