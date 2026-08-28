<script lang="ts">
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import {
  createProjectWithFiles,
  createProjectWithMainFile,
  projectStore,
} from "../../ProjectState.svelte";
import { seedExampleProjectDiagrams } from "../../example_system";
import {
  type ExampleProject,
  get_example_projects,
} from "../../rhizz_wasm_wrapper";
import type { Project } from "../../vfs/types";

let projects = $state<Project[]>([]);
let loading = $state(true);
let showExampleModal = $state(false);
let exampleProjects = $state<ExampleProject[]>([]);

async function refresh() {
  const loaded = await projectStore.listProjects();
  // Most recently touched first — the store bumps a project's updatedAt
  // on every node mutation (see vfs/operations.ts), so this surfaces
  // whatever was last worked on.
  projects = loaded.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  loading = false;
}

$effect(() => {
  void refresh();
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

function openExampleModal() {
  exampleProjects = get_example_projects();
  showExampleModal = true;
}

async function selectExample(example: ExampleProject) {
  showExampleModal = false;
  const name = prompt("Project name?", example.name);
  if (!name) return;
  const project = await createProjectWithFiles(name, example.files);
  if (example.id === "single-file") {
    await seedExampleProjectDiagrams(project.id);
  }
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
        <button class="btn btn-outline" onclick={openExampleModal}>
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

{#if showExampleModal}
  <dialog class="modal modal-open">
  <div
    class="modal-box max-w-2xl bg-base-100 text-base-content border border-base-content/10 shadow-2xl">
    <div class="flex items-center justify-between mb-2">
      <h3
        class="font-bold text-lg text-base-content">Choose an Example Architecture</h3>
      <button
        class="btn btn-sm btn-circle btn-ghost"
        onclick={() => (showExampleModal = false)}
        aria-label="Close"
      >
          ✕
        </button>
    </div>
    <p class="text-sm text-base-content/70 mb-4">
        Select a template system from the bundled examples to initialize your new workspace.
      </p>

    <div
      class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto p-1">
        {#each exampleProjects as example (example.id)}
          <button
            class="card bg-base-200 hover:bg-base-300 hover:border-primary/50 transition text-left p-4 cursor-pointer border border-base-content/10 flex flex-col justify-between"
            onclick={() => selectExample(example)}
          >
            <div>
              <div class="flex items-start justify-between gap-2 mb-1">
                <div class="font-semibold text-base-content text-sm">{example.name}</div>
                <span class="badge badge-xs badge-neutral shrink-0">
                  {example.files.length} {example.files.length === 1 ? "file" : "files"}
                </span>
              </div>
              <div class="text-xs text-base-content/70 mt-1 line-clamp-3">
                {example.description}
              </div>
            </div>
          </button>
        {/each}
      </div>

    <div class="modal-action mt-4">
      <button class="btn btn-ghost btn-sm"
        onclick={() => (showExampleModal = false)}>
          Cancel
        </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={() => (showExampleModal = false)}>close</button>
  </form>
</dialog>
{/if}
