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
  isOpen = $bindable(false),
}: {
  project?: ProjectJS | null;
  errorCount?: number | null;
  warningCount?: number | null;
  isOpen?: boolean;
} = $props();

let activeProjectId = $derived(getCurrentProjectId());
let activeProject = $derived(getCurrentProject());
let activeScore = $derived(getCurrentScore());
let stateDiagnostics = $derived(getCurrentDiagnostics());

let effErrorCount = $derived(errorCount ?? stateDiagnostics?.errors ?? null);
let effWarningCount = $derived(
  warningCount ?? stateDiagnostics?.warnings ?? null,
);

function toggleMenu() {
  isOpen = !isOpen;
}

function closeMenu() {
  isOpen = false;
}
</script>

<header
  class="bg-base-100 text-base-content border-b border-base-300 w-full shrink-0 z-30">
  <div class="navbar min-h-12 px-2 sm:px-4 flex items-center justify-between">
    <!-- Left section: Brand + Desktop navigation links + Project title -->
    <div class="flex items-center gap-2 min-w-0">
      <a
        href={resolve("/projects", {})}
        class="btn btn-ghost btn-sm sm:btn-md text-lg sm:text-xl shrink-0 font-bold"
      >
        ← rhizz
      </a>

      <!-- Desktop navigation links (positioned next to ← rhizz button) -->
      <div class="hidden md:flex items-center gap-1">
        {#if activeProjectId}
          <a
            href={resolve("/projects/[id]/editor", { id: activeProjectId })}
            class="btn btn-ghost btn-sm"
          >Editor</a>
          <a
            href={resolve("/projects/[id]/diagrams", { id: activeProjectId })}
            class="btn btn-ghost btn-sm"
          >Diagrams</a>
          <a
            href={resolve("/projects/[id]/explore", { id: activeProjectId })}
            class="btn btn-ghost btn-sm"
          >Explore</a>
          <a
            href={resolve("/projects/[id]/overview", { id: activeProjectId })}
            class="btn btn-ghost btn-sm"
          >System Overview</a>
        {/if}
      </div>

      {#if activeProject}
        <span class="ml-2 text-xs sm:text-sm text-base-content/70 truncate max-w-[140px] sm:max-w-[200px]">
          {activeProject.name}
        </span>
      {:else if project}
        <span class="ml-2 text-xs sm:text-sm text-base-content/70 truncate max-w-[140px] sm:max-w-[200px]">
          {project.name}
        </span>
      {/if}
    </div>

    <!-- Right section: Desktop badges & controls, Mobile hamburger button -->
    <div class="ml-auto flex items-center gap-2">
      <!-- Desktop badges and theme toggle -->
      <div class="hidden md:flex items-center gap-2">
        {#if activeScore !== null}
          <div
            class="badge badge-outline badge-info font-medium text-xs"
            title="Architecture maturity / completion score: {activeScore.overall_percentage.toFixed(1)}%"
          >
            Score: {activeScore.overall_percentage.toFixed(0)}%
          </div>
        {/if}
        {#if effErrorCount !== null && effWarningCount !== null}
          <div
            class="badge badge-outline {effErrorCount > 0 ? 'badge-error' : 'badge-success'} text-xs"
          >
            {effErrorCount} errors · {effWarningCount} warnings
          </div>
        {/if}
        <button
          onclick={toggleTheme}
          class="btn btn-ghost btn-sm"
          title="Toggle light/dark theme"
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
          <a
            href={resolve("/projects/[id]/editor", { id: activeProjectId })}
            class="btn btn-ghost btn-sm justify-start w-full text-left"
            onclick={closeMenu}
          >
            📝 Editor
          </a>
          <a
            href={resolve("/projects/[id]/diagrams", { id: activeProjectId })}
            class="btn btn-ghost btn-sm justify-start w-full text-left"
            onclick={closeMenu}
          >
            📐 Diagrams
          </a>
          <a
            href={resolve("/projects/[id]/explore", { id: activeProjectId })}
            class="btn btn-ghost btn-sm justify-start w-full text-left"
            onclick={closeMenu}
          >
            🧭 Explore
          </a>
          <a
            href={resolve("/projects/[id]/overview", { id: activeProjectId })}
            class="btn btn-ghost btn-sm justify-start w-full text-left"
            onclick={closeMenu}
          >
            🔍 System Overview
          </a>
        </div>
        <div class="divider my-1"></div>
      {/if}

      <!-- Mobile badges -->
      <div class="flex flex-wrap items-center gap-2 py-1">
        {#if activeScore !== null}
          <div class="badge badge-outline badge-info font-medium text-xs">
            Score: {activeScore.overall_percentage.toFixed(0)}%
          </div>
        {/if}
        {#if effErrorCount !== null && effWarningCount !== null}
          <div
            class="badge badge-outline {effErrorCount > 0 ? 'badge-error' : 'badge-success'} text-xs"
          >
            {effErrorCount} errors · {effWarningCount} warnings
          </div>
        {/if}
      </div>

      <!-- Mobile theme toggle -->
      <div class="flex items-center justify-between pt-1">
        <span class="text-xs text-base-content/70">Theme</span>
        <button
          onclick={toggleTheme}
          class="btn btn-ghost btn-xs flex items-center gap-1.5"
          type="button"
        >
          <span>{getTheme() === "dark" ? "🌙 Dark" : "☀️ Light"}</span>
        </button>
      </div>
    </nav>
  {/if}
</header>
