<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import {
    createProjectWithFiles,
    getCurrentProject,
    getCurrentProjectId,
    projectStore,
  } from "../ProjectState.svelte";
  import { get_example_projects } from "../rhizz_wasm_wrapper";
  import { toastState } from "../ToastState.svelte";
  import { resolveIcon } from "../iconHelper";
  import { TOUR_TARGETS } from "../tour/tourTargets";
  import { requestTourStart } from "../tour/tourRequest.svelte";
  import { WORKSPACE_PAGES } from "../commands/workspacePages";
  import { requestPalette } from "../commands/paletteRequest.svelte";
  import { getSettingsRequest } from "../commands/settingsRequest.svelte";
  import { paletteShortcutHint } from "./palette/commandPalette";
  import LockBadge from "./LockBadge.svelte";
  import SettingsModal from "./SettingsModal.svelte";
  import { projectLock } from "../collab/projectLock.svelte";

  let settingsOpen = $state(false);

  // A palette action (project layout) asks for settings through a shared
  // request — the two layouts share no props, same as the palette/tour pair.
  // Settings is global, so the request is a bare generation bump with no
  // project to aim at.
  let lastHandledSettingsRequest = 0;
  $effect(() => {
    const { generation } = getSettingsRequest();
    if (generation === lastHandledSettingsRequest) return;
    lastHandledSettingsRequest = generation;
    settingsOpen = true;
  });

  // `isOpen` (the mobile menu) is bindable purely as a test seam: the real app
  // renders `<Navbar />` with no props and reads everything from the shared
  // ProjectState singleton below.
  let { isOpen = $bindable(false) }: { isOpen?: boolean } = $props();

  // The project-scoped workspace links live in ../commands/workspacePages, so
  // this navbar and the command palette's "Go to …" rows are rendered from
  // one list and cannot drift apart. `href` is a thunk so `resolve` still sees
  // a literal route id (typed routes).
  const NAV_LINKS = WORKSPACE_PAGES;

  let activeProjectId = $derived(getCurrentProjectId());
  let activeProject = $derived(getCurrentProject());

  // Magnifier for the command palette button, gear for the settings button.
  let searchIcon = $derived(resolveIcon("magnifying-glass"));
  let settingsIcon = $derived(resolveIcon("gear"));

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
      await goto(resolve("/projects/[id]/overview", { id: first.id }));
      requestTourStart(first.id);
      return;
    }
    const drone = get_example_projects().find(
      (example) => example.id === "drone",
    );
    if (!drone) return;
    toastState.show("Creating a new project for the introduction", "info");
    const created = await createProjectWithFiles(drone.name, drone.files);
    await goto(resolve("/projects/[id]/overview", { id: created.id }));
    requestTourStart(created.id);
  }
</script>

<header
  class="bg-base-100 text-base-content border-b border-base-300 w-full shrink-0 z-30"
  data-tour={TOUR_TARGETS.navbar}
>
  <div
    class="navbar min-h-12 px-2 sm:px-4 flex items-center justify-between relative"
  >
    <!-- Left section: Brand + Desktop navigation links -->
    <div class="flex items-center gap-2 min-w-0">
      <a
        href={resolve("/projects")}
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
              class="btn btn-ghost btn-sm">{link.label}</a
            >
          {/each}
        {/if}
      </div>
    </div>

    <!-- Center: project title, truly centered regardless of side widths.
         The title and the lock icon are one dropdown trigger opening the
         holder menu. -->
    {#if activeProject}
      <span
        class="absolute left-1/2 -translate-x-1/2 hidden sm:flex items-center gap-2 max-w-35 sm:max-w-50"
      >
        <LockBadge holder={projectLock.lockedBy} label={activeProject.name} />
      </span>
    {/if}

    <!-- Right section: Desktop controls, Mobile hamburger button -->
    <div class="ml-auto flex items-center gap-2 min-w-0">
      <!-- Desktop controls: palette (inside a project) and settings.
           Theme and tour live in the settings modal now. -->
      <div class="hidden md:flex items-center gap-2">
        <!-- The palette's other way in. A shortcut nobody can discover is
             only a shortcut for the people who wrote it, so the navbar
             offers the same thing — but only inside a project, which is the
             only place the palette exists. -->
        {#if activeProjectId}
          <button
            onclick={() => activeProjectId && requestPalette(activeProjectId)}
            class="btn btn-ghost btn-sm btn-square"
            title="Go to file or command ({paletteShortcutHint(
              typeof navigator === 'undefined' ? '' : navigator.userAgent,
            )})"
            aria-label="Open the go-to palette"
            type="button"
          >
            {#if searchIcon}
              <svg
                viewBox={`0 0 ${searchIcon.width} ${searchIcon.height}`}
                class="w-4 h-4 fill-current"
                aria-hidden="true"
              >
                <path d={searchIcon.svgPath} />
              </svg>
            {/if}
          </button>
        {/if}
        <button
          onclick={() => (settingsOpen = true)}
          class="btn btn-ghost btn-sm btn-square"
          title="Open settings"
          aria-label="Open settings"
          type="button"
        >
          {#if settingsIcon}
            <svg
              viewBox={`0 0 ${settingsIcon.width} ${settingsIcon.height}`}
              class="w-4 h-4 fill-current"
              aria-hidden="true"
            >
              <path d={settingsIcon.svgPath} />
            </svg>
          {/if}
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
    <nav
      class="md:hidden border-t border-base-300 bg-base-100 p-3 flex flex-col gap-2 shadow-lg"
    >
      {#if activeProjectId}
        <LockBadge
          holder={projectLock.lockedBy}
          label={activeProject?.name ?? activeProjectId}
        />
        <div class="flex flex-col gap-1">
          {#each NAV_LINKS as link (link.label)}
            <a
              href={link.href(activeProjectId)}
              class="btn btn-ghost btn-sm justify-start w-full text-left"
              onclick={closeMenu}
            >
              {link.icon}
              {link.label}
            </a>
          {/each}
        </div>
        <div class="divider my-1"></div>
      {/if}

      <!-- Theme and tour live in the settings modal now. -->
      <button
        type="button"
        class="btn btn-ghost btn-sm justify-start w-full text-left"
        onclick={() => {
          closeMenu();
          settingsOpen = true;
        }}
      >
        {#if settingsIcon}
          <svg
            viewBox={`0 0 ${settingsIcon.width} ${settingsIcon.height}`}
            class="w-4 h-4 fill-current shrink-0"
            aria-hidden="true"
          >
            <path d={settingsIcon.svgPath} />
          </svg>
        {/if}
        Settings
      </button>
    </nav>
  {/if}
  <SettingsModal
    open={settingsOpen}
    onclose={() => (settingsOpen = false)}
    onstarttour={() => {
      settingsOpen = false;
      void startTourFlow();
    }}
  />
</header>
