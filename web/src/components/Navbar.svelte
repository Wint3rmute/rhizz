<script lang="ts">
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import {
  getSelection,
  getTheme,
  setSelection,
  toggleTheme,
} from "../ThemeState.svelte";
import {
  createProjectWithFiles,
  getCurrentProject,
  getCurrentProjectId,
  getCurrentScore,
  projectStore,
} from "../ProjectState.svelte";
import {
  getWarningLevel,
  setWarningLevel,
  warningLevelLabel,
} from "../WarningLevelState.svelte";
import { get_example_projects, WARNING_LEVELS } from "../rhizz_wasm_wrapper";
import { toastState } from "../ToastState.svelte";
import { resolveIcon } from "../iconHelper";
import { TOUR_TARGETS } from "../tour/tourTargets";
import { requestTourStart } from "../tour/tourRequest.svelte";

// `isOpen` (the mobile menu) is bindable purely as a test seam: the real app
// renders `<Navbar />` with no props and reads everything from the shared
// ProjectState/WarningLevelState singletons below.
let { isOpen = $bindable(false) }: { isOpen?: boolean } = $props();

// The project-scoped workspace links, in navbar order. One list drives both
// the desktop row and the mobile menu, so the two can never drift. `href` is
// a thunk so `resolve` still sees a literal route id (typed routes).
const NAV_LINKS = [
  {
    label: "Overview",
    emoji: "🔍",
    tour: TOUR_TARGETS.navOverview,
    href: (id: string) => resolve("/projects/[id]/overview", { id }),
  },
  {
    label: "Modeling",
    emoji: "📐",
    tour: TOUR_TARGETS.navModeling,
    href: (id: string) => resolve("/projects/[id]/modeling", { id }),
  },
  {
    label: "Inventory",
    emoji: "📦",
    tour: TOUR_TARGETS.navInventory,
    href: (id: string) => resolve("/projects/[id]/inventory", { id }),
  },
  {
    label: "Explore",
    emoji: "🧭",
    tour: TOUR_TARGETS.navExplore,
    href: (id: string) => resolve("/projects/[id]/explore", { id }),
  },
  {
    label: "Code",
    emoji: "📝",
    tour: TOUR_TARGETS.navCode,
    href: (id: string) => resolve("/projects/[id]/code", { id }),
  },
] as const;

let activeProjectId = $derived(getCurrentProjectId());
let activeProject = $derived(getCurrentProject());
let activeScore = $derived(getCurrentScore());
let warningLevel = $derived(getWarningLevel());

// Plain FontAwesome question mark for the guided-tour button.
let tourIcon = $derived(resolveIcon("question"));

function toggleMenu() {
  isOpen = !isOpen;
}

function closeMenu() {
  isOpen = false;
}

// Starts the drone tour: inside a project it simply plays; with no
// project open it opens the first available one, otherwise creates the
// bundled drone example first — then plays on arrival (the project
// layout mounts the tour, which answers this aimed request).
async function startTourFlow(): Promise<void> {
  const current = getCurrentProjectId();
  if (current) {
    requestTourStart(current);
    return;
  }
  const projects = await projectStore.listProjects();
  const first = projects[0];
  if (first !== undefined) {
    await goto(`/projects/${first.id}/overview`);
    requestTourStart(first.id);
    return;
  }
  const drone = get_example_projects().find((example) =>
    example.id === "drone"
  );
  if (!drone) return;
  toastState.show("Creating a new project for the introduction", "info");
  const created = await createProjectWithFiles(drone.name, drone.files);
  await goto(`/projects/${created.id}/overview`);
  requestTourStart(created.id);
}
</script>

{#snippet statusBadges(withScoreTooltip: boolean)}
  {#if activeScore !== null}
    <div
  class="badge badge-outline badge-info font-medium text-xs"
  title={withScoreTooltip
        ? `Architecture maturity / completion score: ${activeScore.overall_percentage.toFixed(1)}%`
        : undefined}
>
      Score: {activeScore.overall_percentage.toFixed(0)}%
    </div>
  {/if}
{/snippet}

{#snippet warningLevelSelect(id: string, labelClass: string)}
  <label for={id} class={labelClass}>Strictness</label>
  <select
  {id}
  class="select"
  value={warningLevel}
  onchange={(event) => setWarningLevel(event.currentTarget.value)}
>
    {#each WARNING_LEVELS as level (level)}
      <option value={level}>{warningLevelLabel(level)}</option>
    {/each}
  </select>
{/snippet}

<header
  class="bg-base-100 text-base-content border-b border-base-300 w-full shrink-0 z-30"
  data-tour={TOUR_TARGETS.navbar}
>
  <div class="navbar min-h-12 px-2 sm:px-4 flex items-center justify-between relative">
    <!-- Left section: Brand + Desktop navigation links -->
    <div class="flex items-center gap-2 min-w-0">
      <a
        href={resolve("/projects", {})}
        class="btn btn-ghost btn-sm sm:btn-md text-lg sm:text-xl shrink-0 font-bold"
      >
        Rhizz
      </a>

      <!-- Desktop navigation links (positioned next to ← rhizz button).
           Each link carries its tour anchor here only (not in the mobile
           copy below): querySelector resolves the first match, so a
           duplicated anchor would spotlight the hidden desktop link on
           mobile. -->
      <div class="hidden md:flex items-center gap-1">
        {#if activeProjectId}
          {#each NAV_LINKS as link (link.label)}
            <a
              href={link.href(activeProjectId)}
              data-tour={link.tour}
              class="btn btn-ghost btn-sm"
            >{link.label}</a>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Center: project title, truly centered regardless of side widths -->
    {#if activeProject}
      <span class="absolute left-1/2 -translate-x-1/2 truncate max-w-35 sm:max-w-50 hidden sm:block">
        {activeProject.name}
      </span>
    {/if}

    <!-- Right section: Desktop badges & controls, Mobile hamburger button -->
    <div class="ml-auto flex items-center gap-2 min-w-0">
      <!-- Desktop badges and theme toggle -->
      <div class="hidden md:flex items-center gap-2">
        {@render statusBadges(true)}
        <!-- Project-wide warning preset: gates which warnings the compiler
             reports (errors are never gated). Persisted across reloads. The
             visible label only appears from `lg` up — the navbar is already
             tight at `md` — but stays in the accessibility tree at every
             width, and `title` explains the control either way. -->
        <!-- The project-wide warning preset: gates which warnings the
             compiler reports (errors are never gated), persisted across
             reloads. The visible label only appears from `lg` up — the
             navbar is already tight at `md` — but stays in the
             accessibility tree at every width, and `title` explains the
             control either way. -->
        <div
          class="flex items-center gap-1.5 whitespace-nowrap text-base-content/70"
          title="How much detail this project is specified at — gates which warnings are reported. Errors are always reported."
        >
          {@render warningLevelSelect("warning-level", "sr-only lg:not-sr-only")}
        </div>
        {#if tourIcon}
          <button
            onclick={() => void startTourFlow()}
            class="btn btn-ghost btn-sm btn-square"
            title="Guided tour through every workspace page"
            aria-label="Start the guided tour"
            type="button"
          >
            <svg
              viewBox={`0 0 ${tourIcon.width} ${tourIcon.height}`}
              class="w-4 h-4 fill-current"
              aria-hidden="true"
            >
              <path d={tourIcon.svgPath} />
            </svg>
          </button>
        {/if}
        <button
          onclick={toggleTheme}
          class="btn btn-ghost btn-sm"
          title="Toggle light/dark theme (pins the choice; Auto follows the browser preference)"
          type="button"
        >
          {getTheme() === "dark" ? "🌙" : "☀️"}
        </button>
      </div>

      <!-- Mobile hamburger button -->
      <button
        type="button"
        class="btn btn-ghost btn-sm md:hidden px-2"
        onclick={toggleMenu}
        aria-label="Toggle navigation menu"
        aria-expanded={isOpen}
      >
        <span class="text-lg leading-none" aria-hidden="true">
          {isOpen ? "✕" : "☰"}
        </span>
      </button>
    </div>
  </div>

  <!-- Mobile expandable vertical menu -->
  {#if isOpen}
    <nav class="md:hidden border-t border-base-300 bg-base-100 p-3 flex flex-col gap-2 shadow-lg">
      {#if activeProjectId}
        <div class="flex flex-col gap-1">
          {#each NAV_LINKS as link (link.label)}
            <a
              href={link.href(activeProjectId)}
              class="btn btn-ghost btn-sm justify-start w-full text-left"
              onclick={closeMenu}
            >
              {link.emoji} {link.label}
            </a>
          {/each}
        </div>
        <div class="divider my-1"></div>
      {/if}

      <!-- Mobile badges -->
      <div class="flex flex-wrap items-center gap-2 py-1">
        {@render statusBadges(false)}
      </div>

      <!-- Mobile warning-level picker: the same project-wide preset as the
           desktop select, which is hidden below the md breakpoint. -->
      <!-- Mobile-menu copy of the same preset (the desktop one is hidden
           below the md breakpoint). -->
      <div class="flex items-center justify-between gap-2 pt-1">
        {@render warningLevelSelect(
          "warning-level-mobile",
          "whitespace-nowrap text-xs text-base-content/70",
        )}
      </div>

      <!-- Mobile theme picker: Auto follows the browser preference;
           picking Light/Dark explicitly pins the theme. -->
      <div class="flex items-center justify-between pt-1">
        <span class="text-xs text-base-content/70">Theme</span>
        <div class="join">
          <button
            onclick={() => setSelection("auto")}
            class="btn btn-ghost btn-xs join-item {getSelection() === 'auto' ? 'btn-active' : ''}"
            type="button"
            title="Follow the browser's preferred color scheme"
          >Auto</button>
          <button
            onclick={() => setSelection("dark")}
            class="btn btn-ghost btn-xs join-item {getSelection() === 'dark' ? 'btn-active' : ''}"
            type="button"
            title="Always use dark theme"
          >🌙 Dark</button>
          <button
            onclick={() => setSelection("light")}
            class="btn btn-ghost btn-xs join-item {getSelection() === 'light' ? 'btn-active' : ''}"
            type="button"
            title="Always use light theme"
          >☀️ Light</button>
        </div>
      </div>
    </nav>
  {/if}
</header>
