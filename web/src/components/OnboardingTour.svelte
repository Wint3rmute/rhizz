<script lang="ts">
import * as tour from "@zag-js/tour";
import { normalizeProps, useMachine } from "@zag-js/svelte";
import { onMount, type Snippet, untrack } from "svelte";

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  /** Element id to spotlight; omit for a centered dialog step. */
  targetId?: string | undefined;
  placement?: tour.StepPlacement | undefined;
}

interface Props {
  /** Zag machine id (unique per tour on the page). */
  id?: string;
  steps: OnboardingStep[];
  /** Increment to (re)start the tour from the first step. */
  startSignal?: number;
  /**
   * localStorage key; when set, the tour auto-starts once (on mount) until
   * it is completed, dismissed or skipped — the classic onboarding pattern.
   */
  autoStartKey?: string | undefined;
  children?: Snippet;
}

let {
  id = "onboarding",
  steps,
  startSignal = 0,
  autoStartKey = undefined,
  children,
}: Props = $props();

function toZagStep(step: OnboardingStep, index: number): tour.StepDetails {
  const last = index === steps.length - 1;
  return {
    id: step.id,
    title: step.title,
    description: step.description,
    type: step.targetId ? "tooltip" : "dialog",
    target: step.targetId
      ? () => document.getElementById(step.targetId as string)
      : undefined,
    placement: step.placement ?? (step.targetId ? "bottom" : "center"),
    backdrop: true,
    arrow: Boolean(step.targetId),
    actions: [
      ...(index > 0 ? [{ label: "Back", action: "prev" as const }] : []),
      ...(last
        ? [{ label: "Done", action: "dismiss" as const }]
        : [{ label: "Next", action: "next" as const }]),
      ...(last ? [] : [{ label: "Skip", action: "skip" as const }]),
    ],
  };
}

const zagSteps = $derived(steps.map(toZagStep));

const service = useMachine(tour.machine, () => ({
  id,
  steps: zagSteps,
  spotlightRadius: 8,
  // An onboarding tour ends via its own Back/Next/Skip/Done/✕ controls.
  // Outside clicks must not silently kill it (they also make the flow
  // untestable — any focus shift outside the card dismisses the tour).
  closeOnInteractOutside: false,
  onStatusChange(details: tour.StatusChangeDetails) {
    // Remember that the user finished (or bailed out of) the tour so the
    // auto-start below only ever fires once per browser.
    if (
      autoStartKey &&
      (details.status === "completed" ||
        details.status === "dismissed" ||
        details.status === "skipped")
    ) {
      try {
        localStorage.setItem(autoStartKey, "1");
      } catch {
        // Private browsing etc. — the tour just shows again next visit.
      }
    }
  },
}));
const api = $derived(tour.connect(service, normalizeProps));

onMount(() => {
  if (!autoStartKey || isSeen(autoStartKey)) return;
  api.start();
});

function isSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

$effect(() => {
  const signal = startSignal;
  // Read `api` untracked: starting must only react to the signal, not to
  // every tour state change (api is a fresh object each step).
  if (signal > 0) untrack(() => api.start());
});
</script>

{@render children?.()}

{#if api.open}
  <!-- Fixed overlay root: one stacking context above all page content.
       DOM order (not competing z-indexes) decides paint: backdrop <
       spotlight < positioner. -->
  <div class="tour-root">
  <!-- Dimmed backdrop with a spotlight cutout around the target. -->
  <div {...api.getBackdropProps()} class="tour-backdrop"></div>
  <div {...api.getSpotlightProps()} class="tour-spotlight"></div>

  <!-- Floating card (tooltip) or centered card (dialog). -->
  <div {...api.getPositionerProps()} class="tour-positioner">
    <div {...api.getContentProps()}
      class="tour-content card bg-base-100 shadow-xl">
      {#if api.step?.arrow}
        <div {...api.getArrowProps()} class="tour-arrow">
          <div {...api.getArrowTipProps()} class="tour-arrow-tip"></div>
        </div>
      {/if}
      <div class="card-body gap-2 p-5">
        <div class="flex items-start justify-between gap-4">
          <h2 {...api.getTitleProps()} class="card-title text-base">
            {api.step?.title}
          </h2>
          <button
            {...api.getCloseTriggerProps()}
            class="btn btn-ghost btn-xs btn-square"
            aria-label="Close tour">✕</button
          >
        </div>
        <p {...api.getDescriptionProps()} class="text-sm opacity-80">
          {api.step?.description}
        </p>
        <div class="mt-1 flex items-center justify-between gap-3">
          <span {...api.getProgressTextProps()} class="text-xs opacity-60">
            {api.getProgressText()}
          </span>
          <div class="flex gap-2">
            {#each api.step?.actions ?? [] as action (action.label)}
              <button
                {...api.getActionTriggerProps({ action })}
                class="btn btn-sm"
                class:btn-primary={action.action === "next" ||
                  action.action === "dismiss"}
                class:btn-ghost={action.action === "prev" ||
                  action.action === "skip"}
              >
                {action.label}
              </button>
            {/each}
          </div>
        </div>
        <progress
          class="progress progress-primary w-full"
          value={api.getProgressPercent()}
          max="100"
        ></progress>
      </div>
    </div>
  </div>
</div>
{/if}

<style>
/* Single fixed stacking context above all page content. The root itself
   never intercepts clicks; the backdrop swallows page clicks while the
   positioner stays interactive. */
.tour-root {
  position: fixed;
  inset: 0;
  z-index: 60;
  pointer-events: none;
}
.tour-backdrop {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 0.55);
  pointer-events: auto;
}
.tour-spotlight {
  outline: 2px solid var(--color-primary, #570df8);
  outline-offset: 2px;
  pointer-events: none;
}
.tour-positioner {
  /* Zag sets pointer-events:none until floating-ui resolves the card
     position; a pending/stuck placement must never leave a
     visible-but-dead card, so the card stays clickable unconditionally. */
  pointer-events: auto !important;
}
/* Dialog steps (no target) have no floating coordinates — center them. */
.tour-positioner[data-type="dialog"] {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.tour-positioner[data-type="dialog"] .tour-content {
  pointer-events: auto;
  max-width: min(28rem, calc(100vw - 2rem));
}
.tour-positioner[data-type="tooltip"] .tour-content {
  max-width: min(22rem, calc(100vw - 2rem));
}
.tour-arrow {
  --arrow-size: 12px;
  --arrow-bg: var(--color-base-100, #fff);
}
.tour-arrow-tip {
  border-top-width: 1px;
  border-left-width: 1px;
  border-color: var(--color-base-300, #e5e6e6);
}
</style>
