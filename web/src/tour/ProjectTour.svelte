<script lang="ts">
import OnboardingTour from "../components/OnboardingTour.svelte";
import { droneTourSteps } from "./droneTour";
import { getTourStartSignal } from "./tourRequest.svelte";

// Hosts the quadcopter-drone guided tour. Mounted in the project layout
// (which survives page navigation), so the tour can walk across routes —
// each step carries the href Zag navigates to before spotlighting.
interface Props {
  projectId: string;
}

let { projectId }: Props = $props();

let steps = $derived(droneTourSteps(projectId));
let signal = $derived(getTourStartSignal());
</script>

<OnboardingTour id="drone-tour" {steps} startSignal={signal} />
