<script lang="ts">
import { onMount } from "svelte";
import OnboardingTour from "../components/OnboardingTour.svelte";
import { droneTourSteps } from "./droneTour";
import { consumePendingTourStart, getTourRequest } from "./tourRequest.svelte";

// Hosts the workspace guided tour. Mounted in the project layout
// (which survives page navigation), so the tour can walk across routes —
// each step carries the href Zag navigates to before spotlighting.
//
// Starts on an aimed request for this project, or on a pending first-run
// start armed when the user's first project was created (consumed once).
// Only answers requests aimed at this project (or project-less ones), so
// a stale request from another project never starts the tour here.
// Re-entering this project after requesting replays from step one.
interface Props {
  projectId: string;
}

let { projectId }: Props = $props();

let steps = $derived(droneTourSteps(projectId));
let request = $derived(getTourRequest());
let pendingBump = $state(0);

onMount(() => {
  if (consumePendingTourStart()) pendingBump += 1;
});

let startSignal = $derived(
  Math.max(
    request.projectId === null || request.projectId === projectId
      ? request.generation
      : 0,
    pendingBump,
  ),
);
</script>

<OnboardingTour id="drone-tour" {steps} {startSignal} />
