<script lang="ts">
import { resolve } from "$app/paths";
import { page } from "$app/state";
import { onDestroy } from "svelte";
import ProjectModelProvider from "../../../components/ProjectModelProvider.svelte";
import ProjectStatusBar from "../../../components/ProjectStatusBar.svelte";
import {
  clearCurrentProject,
  getCurrentProject,
  setCurrentProject,
} from "../../../ProjectState.svelte";
import ProjectTour from "../../../tour/ProjectTour.svelte";
import PaletteHost from "../../../commands/PaletteHost.svelte";
import type { LayoutProps } from "./$types";

let { data, children }: LayoutProps = $props();

// Reloads the active project's metadata into the shared ProjectState
// whenever the route's [id] param changes (including the very first
// load) — this is what lets Navbar (which lives outside this layout,
// in the root +layout.svelte) know which project is active without
// prop-drilling. The project's *compiled model* is loaded separately by the
// ProjectModelProvider below; the two are deliberately split, because Navbar
// needs only metadata and the pages need the model.
let loadedId: string | null = null;
let loading = $state(true);

// Leaving all project routes unmounts this layout: drop the active
// project so nothing (navbar links, tour flow) keeps acting on it.
onDestroy(() => {
  clearCurrentProject();
});

$effect(() => {
  const id = data.projectId;
  if (id === loadedId) return;
  loadedId = id;
  loading = true;
  setCurrentProject(id).then(() => {
    loading = false;
  });
});

// Diagram embeds are project-scoped, so they sit under this layout like
// every other project route — but they are chromeless iframe surfaces, not
// pages you navigate around in, so they drop the status bar.
let isEmbed = $derived(page.url.pathname.includes("/embed/"));

let project = $derived(getCurrentProject());
</script>

{#if loading}
  <div class="flex-1 flex items-center justify-center text-base-content/60">
    Loading project…
  </div>
{:else if project === null}
  <div class="flex-1 flex items-center justify-center">
  <div class="card bg-base-200 shadow-xl">
    <div class="card-body items-center text-center">
      <h2 class="card-title">Project not found</h2>
      <p class="text-base-content/60 text-sm">
          No project exists with id "{data.projectId}".
        </p>
      <a href={resolve("/projects")} class="btn btn-primary mt-2">
          Back to projects
        </a>
    </div>
  </div>
</div>
{:else}
  <!-- One compiled model per open project, shared by every page and by the
       status bar, so they can never describe different compiles. -->
  <ProjectModelProvider projectId={data.projectId}>
    <div class="flex-1 flex flex-col min-h-0">
      {@render children()}
      {#if !isEmbed}
        <ProjectStatusBar />
      {/if}
    </div>
    <!-- Workspace guided tour: mounted here (not per-page) so it
         survives the cross-page navigation its steps perform. -->
    <ProjectTour projectId={data.projectId} />
    <!-- Ctrl-P / Ctrl-Shift-P palettes. Mounted here for the same reason,
         and skipped on embeds because those are chromeless iframe surfaces
         (the status bar above makes the same call). Mounting inside the
         project layout is also what confines the palettes to a project being
         open, with no check of its own. -->
    {#if !isEmbed}
      <PaletteHost projectId={data.projectId} />
    {/if}
  </ProjectModelProvider>
{/if}
