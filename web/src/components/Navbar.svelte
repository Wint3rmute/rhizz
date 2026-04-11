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

<div class="navbar bg-gray-900 text-gray-100 border-b border-gray-800">
  <a href={resolve("/", {})} class="btn btn-ghost text-xl text-white"
  >← rhizz</a>
  {#if project}
    <span class="ml-2 text-sm opacity-70">{project.name} {
        project.version
      }</span>
  {/if}
  <div class="ml-auto flex items-center space-x-3">
    {#if errorCount !== null && warningCount !== null}
      <div
        class="badge badge-outline {errorCount > 0 ? 'badge-error' : 'badge-success'}"
      >
        {errorCount} errors · {warningCount} warnings
      </div>
    {/if}
  </div>
</div>
