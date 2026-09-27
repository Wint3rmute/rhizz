<script lang="ts">
// A component's Markdown doc, shown beside the cursor while its node is
// hovered. Lives outside the diagram SVG: it is screen-space HTML, whereas
// the scene is world-space SVG — coupling them would make the scene aware of
// cursors and HTML, and unusable for the pages that have no popup at all.
//
// Position comes from `useDiagramDrilldown`, which keeps the anchor
// scroll-invariant; this component only places what it is given.
import Markdown from "../components/Markdown.svelte";
import type { Anchor } from "./useDiagramDrilldown.svelte";

let {
  doc = null,
  position = null,
  testid = "doc-popup",
}: {
  doc?: string | null;
  /** Container-relative anchor; null hides the popup. */
  position?: Anchor | null;
  testid?: string;
} = $props();
</script>

{#if doc !== null && position !== null}
  <div
  class="absolute z-30 max-w-sm pointer-events-none"
  style="left: {position.x + 12}px; top: {position.y + 12}px;"
>
  <div
    class="card bg-base-100 border border-base-content/40 shadow-xl p-3"
    data-testid={testid}
  >
    <Markdown content={doc} />
  </div>
</div>
{/if}
