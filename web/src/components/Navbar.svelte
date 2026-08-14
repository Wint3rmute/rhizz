<script lang="ts">
import { resolve } from "$app/paths";
import type { ProjectJS } from "rhizz";
import { getTheme, toggleTheme } from "../ThemeState.svelte";
import {
  getCurrentDiagnostics,
  getCurrentProject,
  getCurrentProjectId,
  getCurrentScore,
} from "../ProjectState.svelte";

let {
  project = null,
  errorCount = null,
  warningCount = null,
}: {
  project?: ProjectJS | null;
  errorCount?: number | null;
  warningCount?: number | null;
} = $props();

// The active *workspace* project (vfs/types.ts's Project — a folder of
// files), not to be confused with the `project` prop above (the
// compiled HCL `project {}` block's metadata). Read directly from the
// shared ProjectState singleton rather than via props, since Navbar
// lives in the root layout, outside of routes/projects/[id]'s own
// layout data.
let activeProjectId = $derived(getCurrentProjectId());
let activeProject = $derived(getCurrentProject());
let activeScore = $derived(getCurrentScore());
let stateDiagnostics = $derived(getCurrentDiagnostics());

let effErrorCount = $derived(errorCount ?? stateDiagnostics?.errors ?? null);
let effWarningCount = $derived(
  warningCount ?? stateDiagnostics?.warnings ?? null,
);
</script>

<div class="navbar bg-base-100 text-base-content border-b border-base-300">
  <a href={resolve("/projects", {})} class="btn btn-ghost text-xl">← rhizz</a>
  {#if activeProjectId}
    <a
      href={resolve("/projects/[id]/editor", { id: activeProjectId })}
      class="btn btn-ghost"
    >Editor</a>
    <a
      href={resolve("/projects/[id]/diagrams", { id: activeProjectId })}
      class="btn btn-ghost"
    >Diagrams</a>
    <a
      href={resolve("/projects/[id]/overview", { id: activeProjectId })}
      class="btn btn-ghost"
    >System Overview</a>
  {/if}

  {#if activeProject}
    <span class="ml-2 text-sm text-base-content/70">{activeProject.name}</span>
  {/if}
  {#if project}
    <span class="ml-2 text-sm text-base-content/70">{project.name} {
        project.version
      }</span>
  {/if}
  <div class="ml-auto flex items-center gap-3">
    {#if activeScore !== null}
      <div
        class="badge badge-outline badge-info font-medium"
        title="Architecture maturity / completion score: {activeScore.overall_percentage.toFixed(1)}%"
      >
        Score: {activeScore.overall_percentage.toFixed(0)}%
      </div>
    {/if}
    {#if effErrorCount !== null && effWarningCount !== null}
      <div
        class="badge badge-outline {effErrorCount > 0 ? 'badge-error' : 'badge-success'}"
      >
        {effErrorCount} errors · {effWarningCount} warnings
      </div>
    {/if}
    <button
      onclick={toggleTheme}
      class="btn btn-ghost btn-sm"
      title="Toggle light/dark theme"
    >
      {getTheme() === "dark" ? "🌙" : "☀️"}
    </button>
  </div>
</div>
