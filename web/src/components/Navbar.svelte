<script lang="ts">
import { resolve } from "$app/paths";
import type { ProjectJS } from "rhizz";

let {
  project = null,
  errorCount = null,
  warningCount = null,
}: {
  project?: ProjectJS | null;
  errorCount?: number | null;
  warningCount?: number | null;
} = $props();
</script>

<div class="navbar bg-base-100 text-base-content border-b border-base-300">
  <a href={resolve("/", {})} class="btn btn-ghost text-xl">← rhizz</a>
  <a href={resolve("/editor", {})} class="btn btn-ghost">Editor</a>
  <a href={resolve("/diagrams", {})} class="btn btn-ghost">Diagrams</a>
  <a href={resolve("/overview", {})} class="btn btn-ghost">System Overview</a>

  {#if project}
    <span class="ml-2 text-sm text-base-content/70">{project.name} {
        project.version
      }</span>
  {/if}
  <div class="ml-auto flex items-center gap-3">
    {#if errorCount !== null && warningCount !== null}
      <div
        class="badge badge-outline {errorCount > 0 ? 'badge-error' : 'badge-success'}"
      >
        {errorCount} errors · {warningCount} warnings
      </div>
    {/if}
  </div>
</div>
