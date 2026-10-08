<script lang="ts">
import Navbar from "../components/Navbar.svelte";
import OnboardingTour from "../components/OnboardingTour.svelte";
import Overview from "../routes/projects/[id]/overview/Overview.svelte";
import ModelingPage from "../routes/projects/[id]/modeling/ModelingPage.svelte";
import Inventory from "../routes/projects/[id]/inventory/Inventory.svelte";
import Explore from "../routes/projects/[id]/explore/Explore.svelte";
import CodePage from "../routes/projects/[id]/code/CodePage.svelte";
import { tourSteps } from "./Tour";

// One real workspace page per tour stop, exactly as the app renders it —
// the guided tour spotlights the page's own `data-tour` anchors, so the
// VRT screenshots pin the genuine card/spotlight/placement per step.
// `href`s are stripped: the story iframe is not the SvelteKit app, so a
// `goto` on step change would navigate the preview away.
export type TourWalkPage =
  | "navbar"
  | "overview"
  | "modeling"
  | "inventory"
  | "explore"
  | "code";

interface Props {
  /** Which real page to mount underneath the tour card. */
  page: TourWalkPage;
  /** Project fixture the page reads (seeded by the stories' loaders). */
  projectId: string;
  /** Step id to open on (falls back to the first step when unknown). */
  stepId?: string | undefined;
}

let { page, projectId, stepId }: Props = $props();

let steps = $derived(
  tourSteps(projectId).map(({ href: _href, ...step }) => step),
);
</script>

<div class="h-screen w-screen flex flex-col bg-base-100 text-base-content">
  <Navbar />
  <!-- The Code page mounts Monaco, which fills whatever box it is given
       (see MonacoEditorHost): below the `sm` breakpoint the stats row
       stacks vertically and squeezes the editor to zero height, where it
       renders no lines and never settles. The story browser is narrower
       than that, so the code stop gets a desktop-wide box — a no-op in
       VRT (captured at 1280) that gives the editor a real box to paint. -->
  <div
    class="flex-1 flex flex-col min-h-0 {page === 'code'
      ? 'min-w-[1100px] overflow-x-auto'
      : ''}"
  >
    {#if page === "navbar" || page === "overview"}
      <Overview {projectId} />
    {:else if page === "modeling"}
      <ModelingPage {projectId} />
    {:else if page === "inventory"}
      <Inventory {projectId} />
    {:else if page === "explore"}
      <Explore {projectId} />
    {:else}
      <CodePage {projectId} />
    {/if}
  </div>
</div>

<OnboardingTour id="tour-walk" {steps} startSignal={1} initialStepId={stepId} />
