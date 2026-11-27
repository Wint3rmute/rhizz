<script lang="ts">
  import ScrollingBackground from "./ScrollingBackground.svelte";
  import TipsPanel from "./TipsPanel.svelte";
  import BuildInfo from "./BuildInfo.svelte";
  import ExamplePickerModal from "./ExamplePickerModal.svelte";
  import {
    createEmptyProject,
    listProjectsByRecency,
    openProject,
    tryProjectChange,
  } from "./projectActions";
  import { projectStore } from "../ProjectState.svelte";
  import type { Project } from "../vfs/types";
  import type { BuildInfo as BuildInfoData } from "../buildInfo";

  // The projects list at `/projects`: listing, creation, rename and delete.
  // The landing page lives at `/` (LandingPage.svelte) and links here; this
  // page is the list even when it is empty.
  //
  // `projects`/`loading` are an optional injection seam for Storybook (and
  // future component tests): when supplied they fully take over the
  // rendered state and the store is never read; when absent (the real app)
  // the component reads live from `projectStore`.
  interface Props {
    projects?: Project[] | null;
    // `null` (or absent) means "uncontrolled": read live from the store.
    loading?: boolean | null;
    // Which tip the Tips panel shows. `null` (or absent) means
    // "uncontrolled": a random tip per mount — the app passes nothing,
    // stories pin an index so VRT baselines stay deterministic.
    tipIndex?: number | null;
    // Build info for the footer. Absent means "uncontrolled": the BuildInfo
    // component fetches it from the server itself. Stories inject a fixture.
    buildInfo?: BuildInfoData | null;
  }

  let {
    projects = null,
    loading = null,
    tipIndex = null,
    buildInfo,
  }: Props = $props();

  let localProjects = $state<Project[]>([]);
  let localLoading = $state(true);
  let showExampleModal = $state(false);

  let effectiveProjects = $derived(projects ?? localProjects);
  let effectiveLoading = $derived(loading ?? localLoading);

  async function refresh() {
    localProjects = await listProjectsByRecency();
    localLoading = false;
  }

  $effect(() => {
    // Skip the store read entirely when the caller supplied explicit
    // `projects` (Storybook): the effect stays subscribed to the prop so
    // switching between controlled/uncontrolled stays consistent.
    if (projects === null) void refresh();
  });

  async function renameProject(project: Project) {
    const name = prompt("New name?", project.name);
    if (!name || name === project.name) return;
    // Renaming re-derives the address, so it can collide exactly like a
    // create does — and the project keeps its old address when it does.
    await tryProjectChange(() => projectStore.renameProject(project.id, name));
    await refresh();
  }

  async function deleteProject(project: Project) {
    const confirmed = confirm(
      `Delete "${project.name}"? This can't be undone.`,
    );
    if (!confirmed) return;
    await projectStore.deleteProject(project.id);
    await refresh();
  }
</script>

<div class="flex-1 w-full bg-base-100 overflow-y-auto">
  {#if effectiveLoading}
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <p class="text-base-content/60">Loading…</p>
    </div>
  {:else}
    <div class="relative min-h-[70vh]">
      <!-- Scrolling screenshot background fills the space around the list. -->
      <ScrollingBackground />

      <div class="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <!-- Solid card holding the projects list, same style as the landing
               hero card, sitting on top of the scrolling background. -->
        <div
          class="card bg-base-100 shadow-2xl border border-base-content/10 min-h-[100vh]"
        >
          <div class="card-body p-6 sm:p-8 flex flex-col grow">
            <!-- Stacks below `sm` so the actions sit under the heading
                   instead of overflowing a narrow viewport; `sm:flex-row`
                   restores the original side-by-side layout. -->
            <div
              class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6"
            >
              <h1 class="text-2xl font-semibold text-base-content">Projects</h1>
              <!-- While the list is empty its empty state offers these
                   same actions, so the header leaves them out rather than
                   showing every button twice. -->
              {#if effectiveProjects.length > 0}
                <div class="flex flex-col gap-2 sm:flex-row">
                  <button
                    class="btn btn-outline"
                    onclick={() => (showExampleModal = true)}
                  >
                    New from example
                  </button>
                  <button class="btn btn-primary" onclick={createEmptyProject}>
                    New project
                  </button>
                </div>
              {/if}
            </div>

            {#if effectiveProjects.length === 0}
              <!-- The list's own empty state (the landing page is at `/`):
                   says so, and starts a project right here. -->
              <div
                data-testid="projects-empty"
                class="flex flex-col items-center text-center gap-3 px-6 py-12"
              >
                <div class="text-3xl">🗂️</div>
                <div class="font-semibold text-base-content">
                  No projects yet
                </div>
                <p class="text-sm text-base-content/70 max-w-sm">
                  Start a blank model, or pick an example system to learn from.
                </p>
                <div class="flex flex-col gap-2 sm:flex-row">
                  <button
                    class="btn btn-outline"
                    onclick={() => (showExampleModal = true)}
                  >
                    New from example
                  </button>
                  <button class="btn btn-primary" onclick={createEmptyProject}>
                    New project
                  </button>
                </div>
              </div>
            {/if}

            <ul class="space-y-2">
              {#each effectiveProjects as project (project.id)}
                <li
                  class="card bg-base-200 shadow flex-row items-center px-4 py-3 gap-4"
                >
                  <button
                    class="flex-1 text-left cursor-pointer"
                    onclick={() => openProject(project)}
                  >
                    <div class="font-semibold text-base-content">
                      {project.name}
                    </div>
                    <div class="text-xs text-base-content/50">
                      Updated {new Date(project.updatedAt).toLocaleString()}
                    </div>
                  </button>
                  <button
                    class="btn btn-ghost btn-sm"
                    onclick={() => renameProject(project)}
                  >
                    Rename
                  </button>
                  <button
                    class="btn btn-ghost btn-sm text-error"
                    onclick={() => deleteProject(project)}
                  >
                    Delete
                  </button>
                </li>
              {/each}
            </ul>

            <!-- mt-auto pushes the divider + tips to the bottom of the
                   full-height card, so on short lists the panel rests at the
                   viewport bottom (where sticky then holds it during scroll)
                   instead of floating mid-card. -->
            <div class="divider mt-auto"></div>
            <TipsPanel index={tipIndex} />
            <BuildInfo {buildInfo} />
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<ExamplePickerModal bind:open={showExampleModal} />
