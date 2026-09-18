<script lang="ts">
import OnboardingTour from "../components/OnboardingTour.svelte";
import { droneTourSteps } from "./droneTour";
import { getTourRequest } from "./tourRequest.svelte";

// Hosts the workspace guided tour. Mounted in the project layout
// (which survives page navigation), so the tour can walk across routes —
// each step carries the href Zag navigates to before spotlighting.
//
// Only answers requests aimed at this project (or project-less ones), so
// a stale request from another project never starts the tour here.
// Re-entering this project after requesting replays from step one.
interface Props {
  projectId: string;
}

let { projectId }: Props = $props();

let steps = $derived(droneTourSteps(projectId));
let request = $derived(getTourRequest());
let startSignal = $derived(
  request.projectId === null || request.projectId === projectId
    ? request.generation
    : 0,
);
</script>

<OnboardingTour id="drone-tour" {steps} {startSignal} />
