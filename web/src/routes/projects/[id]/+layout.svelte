<script lang="ts">
import { resolve } from "$app/paths";
import { page } from "$app/state";
import { onDestroy } from "svelte";
import DiagnosticsStatusBar from "../../../components/DiagnosticsStatusBar.svelte";
import { compile_system } from "../../../rhizz_wasm_wrapper";
import {
  clearCurrentProject,
  getCurrentProject,
  setCurrentProject,
} from "../../../ProjectState.svelte";
import { projectStore } from "../../../ProjectState.svelte";
import { getWarningLevel } from "../../../WarningLevelState.svelte";
import { readProjectSources, type Source } from "../../../vfs/compile";
import { openProjectFs } from "../../../vfs/fs";
import ProjectTour from "../../../tour/ProjectTour.svelte";
import type { LayoutProps } from "./$types";

let { data, children }: LayoutProps = $props();

// Reloads the active project's metadata into the shared ProjectState
// whenever the route's [id] param changes (including the very first
// load) — this is what lets Navbar (which lives outside this layout,
// in the root +layout.svelte) know which project is active without
// prop-drilling.
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
  // Project-wide sources for the diagnostics status bar below (mirrors
  // what each page compiles individually — a snapshot per navigation).
  const fs = openProjectFs(projectStore, id);
  void readProjectSources(fs).then((s) => {
    layoutSources = s;
  });
});

// Embedded diagram views (iframe embeds) stay chrome-free: no bar.
let isEmbed = $derived(page.url.pathname.includes("/embed/"));

let layoutSources = $state<Source[]>([]);

// The project-wide warning preset (navbar select); reading it inside the
// `$derived` compile keeps the status bar reactive to it.
let warningLevel = $derived(getWarningLevel());
let layoutOutput = $derived.by(() =>
  compile_system(layoutSources, warningLevel)
);
let layoutDiagnostics = $derived(layoutOutput.diagnostics());

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
      <a href={resolve("/projects", {})} class="btn btn-primary mt-2">
          Back to projects
        </a>
    </div>
  </div>
</div>
{:else}
  <div class="flex-1 flex flex-col min-h-0">
    {@render children()}
    {#if !isEmbed}
      <DiagnosticsStatusBar diagnostics={layoutDiagnostics} />
    {/if}
  </div>
  <!-- Workspace guided tour: mounted here (not per-page) so it
       survives the cross-page navigation its steps perform. -->
  <ProjectTour projectId={data.projectId} />
{/if}
