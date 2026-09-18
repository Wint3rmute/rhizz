<script lang="ts">
import OnboardingTour, {
  type OnboardingStep,
} from "../../components/OnboardingTour.svelte";

// Demo onboarding: five steps over a mock of the Rhizz workspace —
// welcome dialog, three spotlighted areas, closing dialog.
const steps: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to Rhizz 👋",
    description:
      "Systems are described in .hcl files you can version, diff and review — with or without a GUI. This quick tour shows the workspace.",
  },
  {
    id: "projects",
    title: "Projects",
    description:
      "Every system lives in a project. Pick one to open its editor, diagrams and diagnostics.",
    targetId: "demo-nav",
    placement: "bottom",
  },
  {
    id: "editor",
    title: "Code-first model",
    description:
      "The system model is plain HCL text. Edits here recompile live and update every view.",
    targetId: "demo-editor",
    placement: "right",
  },
  {
    id: "diagram",
    title: "Diagrams",
    description:
      "Drag components onto the canvas, connect them, add notes. Layout is stored per view in diagrams/*.hcl.",
    targetId: "demo-diagram",
    placement: "left",
  },
  {
    id: "done",
    title: "You're set 🚀",
    description:
      "Open a real project from the list, or replay this tour any time with the button below.",
  },
];

let startSignal = $state(0);
</script>

<svelte:head>
  <title>Walkthrough demo — Rhizz</title>
</svelte:head>

<OnboardingTour
  id="walkthrough-demo"
  {steps}
  {startSignal}
  autoStartKey="rhizz-walkthrough-seen"
>
  <div class="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
    <header
      id="demo-nav"
      class="navbar rounded-box bg-base-200 px-4 shadow"
      data-testid="demo-nav"
    >
      <span class="text-lg font-bold">Rhizz</span>
      <span class="badge badge-primary ml-2">demo workspace</span>
      <div class="ms-auto flex gap-2">
        <button
          class="btn btn-primary btn-sm"
          onclick={() => (startSignal += 1)}
          data-testid="start-tour"
        >
          {startSignal > 0 ? "Replay tour" : "Start tour"}
        </button>
      </div>
    </header>

    <div class="grid gap-6 md:grid-cols-2">
      <section
        id="demo-editor"
        class="card bg-base-200 shadow"
        data-testid="demo-editor"
      >
        <div class="card-body">
          <h2 class="card-title">system.hcl</h2>
          <pre class="mockup-code text-xs">{`system "consumer-drone" {
  instance "flight-controller" {}
  instance "propulsion" {}
}`}</pre>
        </div>
      </section>

      <section
        id="demo-diagram"
        class="card bg-base-200 shadow"
        data-testid="demo-diagram"
      >
        <div class="card-body">
          <h2 class="card-title">Diagram canvas</h2>
          <div class="flex items-center gap-4 rounded-box bg-base-100 p-6">
            <div class="badge badge-outline p-4">flight-controller</div>
            <div class="flex-1 border-t-2 border-dashed border-primary"></div>
            <div class="badge badge-outline p-4">propulsion</div>
          </div>
        </div>
      </section>
    </div>

    <section class="card bg-base-200 shadow" data-testid="demo-diagnostics">
      <div class="card-body">
        <h2 class="card-title">Diagnostics</h2>
        <p class="text-sm opacity-70">
          Errors block compilation (<span class="font-mono">E…</span>),
          warnings (<span class="font-mono">W…</span>) are gated by warning
          level. The tour's final dialog points here conceptually — no
          spotlight, just a centered card.
        </p>
      </div>
    </section>
  </div>
</OnboardingTour>
