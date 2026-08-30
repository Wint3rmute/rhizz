<script lang="ts">
// A reusable, slowly-scrolling background of product screenshots. Fills its
// parent (which should be `relative` + `overflow-hidden`) and sits behind
// whatever content is layered on top. The strip is rendered twice so the
// -50% translate loops seamlessly.
import { base } from "$app/paths";

let {
  images = [],
  width = "100vw",
  blur = "4px",
  overlayOpacity = 60,
}: {
  /** Screenshot filenames (relative to `static/screenshots/`). */
  images: string[];
  /** Width of the scrolling strip (per image). */
  width?: string;
  /** Delicate blur applied to the screenshots. */
  blur?: string;
  /** Overlay darkness (0-100) to keep foreground text readable. */
  overlayOpacity?: number;
} = $props();
</script>

<div
  class="absolute inset-0 overflow-hidden pointer-events-none"
  aria-hidden="true"
>
  <div class="scrolling-background flex h-full" style="width: {width}">
    {#each [0, 1] as _ ( _)}
      {#each images as name (name)}
        <img
          src="{base}/screenshots/{name}"
          alt=""
          class="h-full w-auto object-cover"
          style="filter: blur({blur})"
          draggable="false"
        />
      {/each}
    {/each}
  </div>
  <div class="absolute inset-0 bg-base-100/{overlayOpacity}"></div>
</div>
