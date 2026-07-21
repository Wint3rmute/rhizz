<script lang="ts">
import { resolve } from "$app/paths";
import { getCurrentProject, setCurrentProject } from "../../../ProjectState.svelte";
import type { LayoutProps } from "./$types";

let { data, children }: LayoutProps = $props();

// Reloads the active project's metadata into the shared ProjectState
// whenever the route's [id] param changes (including the very first
// load) — this is what lets Navbar (which lives outside this layout,
// in the root +layout.svelte) know which project is active without
// prop-drilling.
let loadedId: string | null = null;
let loading = $state(true);

$effect(() => {
  const id = data.projectId;
  if (id === loadedId) return;
  loadedId = id;
  loading = true;
  setCurrentProject(id).then(() => {
    loading = false;
  });
});

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
  {@render children()}
{/if}
