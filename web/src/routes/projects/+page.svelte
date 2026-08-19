<script lang="ts">
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../ProjectState.svelte";
import {
  EXAMPLE_SYSTEM_HCL,
  seedExampleProjectDiagrams,
} from "../../example_system";
import type { Project } from "../../vfs/types";

let projects = $state<Project[]>([]);
let loading = $state(true);

async function refresh() {
  const loaded = await projectStore.listProjects();
  // Most recently touched first — the store bumps a project's updatedAt
  // on every node mutation (see vfs/operations.ts), so this surfaces
  // whatever was last worked on.
  projects = loaded.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  loading = false;
}

$effect(() => {
  refresh();
});

async function openProject(project: Project) {
  await goto(resolve("/projects/[id]/editor", { id: project.id }));
}

async function createEmpty() {
  const name = prompt("Project name?", "Untitled project");
  if (!name) return;
  const project = await createProjectWithMainFile(
    name,
    "# Your input goes here",
  );
  await refresh();
  await openProject(project);
}

async function createFromExample() {
  const name = prompt("Project name?", "Example project");
  if (!name) return;
  const project = await createProjectWithMainFile(name, EXAMPLE_SYSTEM_HCL);
  await seedExampleProjectDiagrams(project.id);
  await refresh();
  await openProject(project);
}

async function renameProject(project: Project) {
  const name = prompt("New name?", project.name);
  if (!name || name === project.name) return;
  await projectStore.renameProject(project.id, name);
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
  <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold text-base-content">Projects</h1>
      <div class="flex gap-2">
        <button class="btn btn-outline" onclick={createFromExample}>
          New from example
        </button>
        <button class="btn btn-primary" onclick={createEmpty}>
          New project
        </button>
      </div>
    </div>

    {#if loading}
      <p class="text-base-content/60">Loading…</p>
    {:else if projects.length === 0}
      <div class="card bg-base-200 shadow">
        <div class="card-body items-center text-center py-16">
          <div class="text-5xl mb-4">🗂️</div>
          <h2 class="card-title text-base-content">No projects yet</h2>
          <p class="text-base-content/60 text-sm">
            Create an empty project, or start from the bundled example.
          </p>
        </div>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each projects as project (project.id)}
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
    {/if}
  </div>
</div>
