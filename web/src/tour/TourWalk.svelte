<script lang="ts">
import OnboardingTour from "../components/OnboardingTour.svelte";
import { tourSteps } from "./Tour";
import { TOUR_TARGETS } from "./tourTargets";

// Static stand-in for the workspace chrome the guided tour spotlights:
// one small bar per `data-tour` anchor, laid out like the app shell
// (navbar on top, page body below). Lets every tour step resolve its
// target without mounting routed pages — the `TourWalk` stories start
// the real `OnboardingTour` at each step id for per-step VRT shots.
//
// `href`s are stripped: the story iframe is not the SvelteKit app, so a
// `goto` on step change would navigate the preview away. The card,
// spotlight, placement and progress are untouched — those are what the
// screenshots pin.
interface Props {
  /** Step id to open on (falls back to the first step when unknown). */
  stepId?: string | undefined;
}

let { stepId }: Props = $props();

let steps = $derived(
  tourSteps("story-project").map(({ href: _href, ...step }) => step),
);
</script>

<div class="min-h-screen bg-base-100 text-base-content flex flex-col">
  <!-- Navbar strip: workspace links carry the preview-stop anchors. -->
  <header
    class="bg-base-100 border-b border-base-300 w-full shrink-0"
    data-tour={TOUR_TARGETS.navbar}
  >
    <div class="navbar min-h-12 px-4 flex items-center gap-1">
      <span class="font-bold text-lg mr-2">Rhizz</span>
      <span
        class="btn btn-ghost btn-sm"
        data-tour={TOUR_TARGETS.navOverview}>Overview</span>
      <span
        class="btn btn-ghost btn-sm"
        data-tour={TOUR_TARGETS.navModeling}>Modeling</span>
      <span
        class="btn btn-ghost btn-sm"
        data-tour={TOUR_TARGETS.navInventory}>Inventory</span>
      <span
        class="btn btn-ghost btn-sm"
        data-tour={TOUR_TARGETS.navExplore}>Explore</span>
      <span
        class="btn btn-ghost btn-sm"
        data-tour={TOUR_TARGETS.navCode}>Code</span>
    </div>
  </header>

  <!-- Page body: one small chrome block per content-stop anchor. -->
  <main class="flex-1 p-6 flex flex-col gap-4 max-w-4xl w-full mx-auto">
    <div class="card bg-base-200 shadow" data-tour={TOUR_TARGETS.overview}>
      <div class="card-body py-4">
        <h1 class="text-2xl font-bold">Story project</h1>
      </div>
    </div>
    <div
      class="bg-base-100 border border-base-300 rounded-box shadow-lg p-2 self-center"
      data-tour={TOUR_TARGETS.diagramToolbar}
    >
      <span class="btn btn-ghost btn-sm">Auto Layout</span>
      <span class="btn btn-ghost btn-sm">Zoom to Fill</span>
    </div>
    <aside
      class="bg-base-100 border border-base-300 p-4 w-64"
      data-tour={TOUR_TARGETS.diagramSidebar}
    >
      <h3 class="font-semibold text-sm mb-3 uppercase">Inspector</h3>
    </aside>
    <div class="flex items-center gap-1" data-tour={TOUR_TARGETS.inventory}>
      <span class="btn btn-xs btn-primary">Components</span>
      <span class="btn btn-xs btn-ghost">Systems</span>
    </div>
    <aside
      class="bg-base-100 border border-base-300 p-4 w-64"
      data-tour={TOUR_TARGETS.explore}
    >
      <h3 class="font-semibold text-sm mb-3 uppercase">Diagrams</h3>
    </aside>
    <h1 class="text-2xl font-semibold" data-tour={TOUR_TARGETS.editor}>
      Editor
    </h1>
  </main>
</div>

<OnboardingTour id="tour-walk" {steps} startSignal={1} initialStepId={stepId} />
