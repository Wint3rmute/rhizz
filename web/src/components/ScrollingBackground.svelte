<script lang="ts">
// A reusable, slowly-scrolling background of product screenshots. Fills its
// parent (which should be `relative` + `overflow-hidden`) and sits behind
// whatever content is layered on top. The strip is rendered twice so the
// -50% translate loops seamlessly.
// Import the screenshots directly so Vite processes them into hashed URLs
// that work regardless of the app's base path (local, GitHub Pages, and
// Storybook/Chromatic all resolve them correctly).
import bg1 from "../screenshots/background_1.png";
import bg2 from "../screenshots/background_2.png";
import bg3 from "../screenshots/background_3.png";
import bg4 from "../screenshots/background_4.png";

const images = [bg1, bg2, bg3, bg4];

let {
  width = "100vw",
  blur = "4px",
}: {
  /** Width of the scrolling strip (per image). */
  width?: string;
  /** Delicate blur applied to the screenshots. */
  blur?: string;
} = $props();
</script>

<div
  class="absolute inset-0 overflow-hidden pointer-events-none"
  aria-hidden="true"
>
  <div class="scrolling-background flex h-full" style="width: {width}">
    {#each [0, 1] as _ ( _)}
      {#each images as src (src)}
        <img
          {src}
          alt=""
          class="h-full w-auto object-cover"
          style="filter: blur({blur})"
          draggable="false"
        />
      {/each}
    {/each}
  </div>
  <div class="absolute inset-0 bg-base-100"
    style="opacity: var(--scrolling-bg-overlay)"></div>
</div>
