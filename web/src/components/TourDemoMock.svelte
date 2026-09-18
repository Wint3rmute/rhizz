<script lang="ts">
import ProjectTour from "../tour/ProjectTour.svelte";
import { TOUR_TARGETS } from "../tour/tourTargets";
import { requestTourStart } from "../tour/tourRequest.svelte";

// Compact mock workspace carrying every tour anchor — story-only. It gives
// the ProjectTour stories something to render (the host alone is an empty
// overlay) and lets plays walk the full cross-page tour against local
// targets while step navigation no-ops in Storybook.
interface Props {
  projectId: string;
}

let { projectId }: Props = $props();
</script>

<div
  class="flex min-h-[560px] flex-col gap-3 bg-base-100 p-4 text-base-content">
  <header
    data-tour={TOUR_TARGETS.navbar}
    class="navbar rounded-box bg-base-200 px-4 shadow"
  >
    <span class="text-lg font-bold">Rhizz</span>
    <span class="badge badge-primary ml-2">story workspace</span>
    <div class="ms-auto">
      <button
        class="btn btn-primary btn-sm"
        data-testid="tour-start"
        onclick={() => requestTourStart(projectId)}
      >
        Start tour
      </button>
    </div>
  </header>

  <div class="grid grid-cols-2 gap-3">
    <section data-tour={TOUR_TARGETS.overview} class="card bg-base-200 shadow">
      <div class="card-body p-4">
        <h2 class="card-title text-base">Overview</h2>
        <p class="text-sm opacity-70">12 components · score 87%</p>
      </div>
    </section>
    <section data-tour={TOUR_TARGETS.editor} class="card bg-base-200 shadow">
      <div class="card-body p-4">
        <h2 class="card-title text-base">Editor</h2>
        <p class="font-mono text-xs opacity-70">system.hcl</p>
      </div>
    </section>
    <section data-tour={TOUR_TARGETS.inventory} class="card bg-base-200 shadow">
      <div class="card-body p-4">
        <h2 class="card-title text-base">Inventory</h2>
        <p class="text-sm opacity-70">definitions, ports, protocols</p>
      </div>
    </section>
    <section data-tour={TOUR_TARGETS.explore} class="card bg-base-200 shadow">
      <div class="card-body p-4">
        <h2 class="card-title text-base">Explore</h2>
        <p class="text-sm opacity-70">docs and diagram links</p>
      </div>
    </section>
  </div>

  <div class="flex min-h-56 flex-1 gap-3">
    <aside
      data-tour={TOUR_TARGETS.diagramSidebar}
      class="card w-44 shrink-0 bg-base-200 shadow"
    >
      <div class="card-body p-4">
        <h2 class="card-title text-base">Sidebar</h2>
        <p class="text-sm opacity-70">selection and inspector</p>
      </div>
    </aside>
    <div class="card relative flex-1 bg-base-300 shadow">
      <div class="card-body p-4">
        <h2 class="card-title text-base">Canvas</h2>
        <div
          data-tour={TOUR_TARGETS.diagramToolbar}
          data-testid="mock-toolbar"
          class="absolute bottom-2 left-1/2 w-max -translate-x-1/2 rounded-box border border-base-300 bg-base-100 px-4 py-2 text-sm shadow-lg"
        >
          Toolbar
        </div>
      </div>
    </div>
  </div>
</div>

<ProjectTour {projectId} />
