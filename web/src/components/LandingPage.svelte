<script lang="ts">
  import { resolve } from "$app/paths";
  import logoMarkUrl from "../../assets/logo-mark.svg";
  import { BOOK_URL } from "../links";
  import ExamplePickerModal from "./ExamplePickerModal.svelte";
  import ScrollingBackground from "./ScrollingBackground.svelte";
  import { createEmptyProject, listProjectsByRecency } from "./projectActions";

  // The landing page at `/`. Always the landing page, whether or not projects
  // exist: the projects list lives at `/projects`, one of the four ways in.
  //
  // `projectCount` is an injection seam for Storybook: when supplied it is
  // shown as-is and the store is never read; when absent (the real app) the
  // count is read from the project store on mount.
  let { projectCount = null }: { projectCount?: number | null } = $props();

  let storedCount = $state<number | null>(null);
  let showExamples = $state(false);

  let count = $derived(projectCount ?? storedCount);

  $effect(() => {
    if (projectCount === null) {
      void listProjectsByRecency().then((p) => (storedCount = p.length));
    }
  });

  let projectsSummary = $derived(
    count === null
      ? "Pick up where you left off."
      : count === 0
        ? "No projects yet"
        : `${count} ${count === 1 ? "project" : "projects"} - pick up where you left off.`,
  );

  // Quoted so the inlined data URI cannot break the url() token.
  const maskImage = `url("${logoMarkUrl}")`;

  // Four cards of the same size; New project keeps the primary colour so a
  // first-time visitor sees where to start.
  const cardClass =
    "card bg-base-200 shadow hover:bg-base-300 hover:border-primary/50 transition text-left p-5 cursor-pointer border border-base-content/10";
  const primaryCardClass =
    "card bg-primary text-primary-content shadow hover:bg-primary/90 transition text-left p-5 cursor-pointer border border-primary/20";
</script>

<div class="flex-1 w-full bg-base-100 overflow-y-auto">
  <div
    class="relative min-h-full flex items-center justify-center overflow-hidden py-6"
  >
    <!-- min-h-full, not h-full: on a short screen the card is taller than the
         viewport, and a fixed height would clip it top and bottom instead of
         letting the page scroll. -->
    <!-- Slowly scrolling background of product screenshots, larger than
         the hero card and filling the whole landing area behind it. -->
    <ScrollingBackground />

    <!-- Solid card holding the hero text and the ways in, sitting on top of
         the scrolling background. -->
    <div
      class="relative card bg-base-100 shadow-2xl border border-base-content/10 max-w-2xl w-full mx-4"
    >
      <div class="card-body items-center text-center p-6 sm:p-12">
        <!-- Mark sits inline before the wordmark, as in the navbar. -->
        <h1
          class="flex items-center justify-center gap-3 text-3xl font-bold text-base-content"
        >
          <span
            data-testid="landing-logo"
            class="inline-block size-9 bg-current"
            style:mask-image={maskImage}
            style:-webkit-mask-image={maskImage}
            style:mask-position="center"
            style:mask-size="contain"
            style:mask-repeat="no-repeat"
            style:-webkit-mask-position="center"
            style:-webkit-mask-size="contain"
            style:-webkit-mask-repeat="no-repeat"
            aria-hidden="true"
          ></span>
          Rhizome
        </h1>
        <p class="text-base-content py-4 max-w-xl">
          Model your system architecture and verify it. Build your system in an
          interactive diagrams editor or write it as code (or have AI write it).
          Explore architecture as interactive, nested diagrams, Detect missing
          pieces, improve your systems completion metrics. All open source, all
          owned by you.
        </p>
        <!-- A 2x2 grid from `sm` up (start or continue on the top row, learn
             on the bottom row); on phones a single column of full-width
             cards in the same order. -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
          <button class={primaryCardClass} onclick={createEmptyProject}>
            <div class="text-2xl mb-2">✨</div>
            <div class="font-semibold">New project</div>
            <p class="text-xs opacity-80 mt-1">
              Start from a blank model and build your own system.
            </p>
          </button>
          <a class={cardClass} href={resolve("/projects")}>
            <div class="text-2xl mb-2">🗂️</div>
            <div class="font-semibold text-base-content">Your projects</div>
            <p class="text-xs text-base-content/70 mt-1">{projectsSummary}</p>
          </a>
          <button class={cardClass} onclick={() => (showExamples = true)}>
            <div class="text-2xl mb-2">🚀</div>
            <div class="font-semibold text-base-content">Learn by example</div>
            <p class="text-xs text-base-content/70 mt-1">
              Explore example systems - moon rocket, a drone, web app and more.
            </p>
          </button>
          <!-- An <a> rather than a <button>: it leaves the app, and only a link
               gets middle-click, a sane focus order and the browser's own
               "open in new tab". -->
          <a
            class={cardClass}
            href={BOOK_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div class="text-2xl mb-2">📖</div>
            <div class="font-semibold text-base-content">Read the book</div>
            <p class="text-xs text-base-content/70 mt-1">
              A guided tour of modeling in Rhizome - from basic to advanced
              concepts.
            </p>
          </a>
        </div>
      </div>
    </div>
  </div>
</div>

<ExamplePickerModal bind:open={showExamples} />
