<script lang="ts">
import { goto } from "$app/navigation";
import { base, resolve } from "$app/paths";
import {
  createProjectWithFiles,
  createProjectWithMainFile,
  projectStore,
} from "../ProjectState.svelte";
import { seedExampleProjectDiagrams } from "../example_system";
import {
  type ExampleProject,
  get_example_projects,
} from "../rhizz_wasm_wrapper";
import type { Project } from "../vfs/types";

// The unified projects/landing page. Rendered both at `/` (the landing
// page) and at `/projects` (the classic route the navbar links to) — a
// single source of truth for project listing, creation, rename/delete and
// the "start from an example" flow.
//
// `projects`/`loading` are an optional injection seam for Storybook (and
// future component tests): when supplied they fully take over the
// rendered state and the store is never read; when absent (the real app)
// the component reads live from `projectStore` exactly like the former
// route-local page did.
interface Props {
  projects?: Project[] | null;
  // `null` (or absent) means "uncontrolled": read live from the store.
  loading?: boolean | null;
}

let { projects = null, loading = null }: Props = $props();

let localProjects = $state<Project[]>([]);
let localLoading = $state(true);
let showExampleModal = $state(false);
let exampleProjects = $state<ExampleProject[]>([]);

let effectiveProjects = $derived(projects ?? localProjects);
let effectiveLoading = $derived(loading ?? localLoading);

// Screenshots that slowly scroll behind the landing hero. Referenced via
// `base` so they resolve correctly both locally (base = "") and on GitHub
// Pages (base = "/<repo>").
const backgroundImages = [
  "background_1.png",
  "background_2.png",
  "background_3.png",
  "background_4.png",
];

async function refresh() {
  const loaded = await projectStore.listProjects();
  // Most recently touched first — the store bumps a project's updatedAt
  // on every node mutation (see vfs/operations.ts), so this surfaces
  // whatever was last worked on.
  localProjects = loaded.toSorted((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  localLoading = false;
}

$effect(() => {
  // Skip the store read entirely when the caller supplied explicit
  // `projects` (Storybook): the effect stays subscribed to the prop so
  // switching between controlled/uncontrolled stays consistent.
  if (projects === null) void refresh();
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
    {#if effectiveLoading}
      <p class="text-base-content/60">Loading…</p>
    {:else if effectiveProjects.length === 0}
      <!-- Empty state doubles as the landing page: a hero with a
           call-to-action to create a new project, either completely new
           or based on one of the bundled examples. -->
      <div class="relative">
        <!-- Slowly scrolling background of product screenshots. -->
        <div
          class="absolute inset-0 overflow-hidden pointer-events-none"
          aria-hidden="true"
        >
          <div class="scrolling-background flex h-full w-max">
            <!-- Rendered twice so the -50% translate loops seamlessly. -->
            {#each [0, 1] as _ ( _)}
              {#each backgroundImages as name (name)}
                <img
                  src="{base}/screenshots/{name}"
                  alt=""
                  class="h-full w-auto object-cover"
                  draggable="false"
                />
              {/each}
            {/each}
          </div>
          <div class="absolute inset-0 bg-base-100/80"></div>
        </div>

        <div class="relative hero min-h-[55vh]">
          <div class="hero-content text-center flex-col">
          <div class="max-w-xl">
            <div class="text-5xl mb-4">🗂️</div>
            <h1 class="text-3xl font-bold text-base-content">rhizz</h1>
            <p class="text-base-content/70 py-4">
              Model your system architecture and verify it. Build your system in
              an interactive diagrams editor or write it as code (or have AI
              write it). Explore architecture as interactive, nested diagrams,
              improve your systems completion metrics. All version-controlled,
              all owned by you. </p> </div> <div class="grid gap-4
              sm:grid-cols-2 w-full max-w-xl">
            <button
              class="card bg-primary text-primary-content shadow hover:bg-primary-focus transition text-left p-5 cursor-pointer border border-primary/20"
              onclick={createEmpty}
            >
              <div class="text-2xl mb-2">✨</div>
              <div class="font-semibold">New project</div>
              <p class="text-xs opacity-80 mt-1">
                Start from a blank
                <code class="font-mono text-xs">system.hcl</code> and build
                your own model.
              </p>
            </button>
            <button
              class="card bg-base-200 shadow hover:bg-base-300 hover:border-primary/50 transition text-left p-5 cursor-pointer border border-base-content/10"
              onclick={openExampleModal}
            >
              <div class="text-2xl mb-2">🚀</div>
              <div class="font-semibold text-base-content">
                Start from an example
              </div>
              <p class="text-xs text-base-content/70 mt-1">
                Explore a bundled template system — drone, socia
                software house and more.
              </p>
            </button>
          </div>
          </div>
        </div>
      </div>
    {:else}
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
    {/if}
  </div>
</div>

{#if showExampleModal}
  <dialog class="modal modal-open">
  <div
    class="modal-box max-w-2xl bg-base-100 text-base-content border border-base-content/10 shadow-2xl"
  >
    <div class="flex items-center justify-between mb-2">
      <h3 class="font-bold text-lg text-base-content">
          Choose an Example Architecture
        </h3>
      <button
        class="btn btn-sm btn-circle btn-ghost"
        onclick={() => (showExampleModal = false)}
        aria-label="Close"
      >
          ✕
        </button>
    </div>
    <p class="text-sm text-base-content/70 mb-4">
        Select a template system from the bundled examples to initialize
        your new workspace.
      </p>

    <div
      class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto p-1"
    >
        {#each exampleProjects as example (example.id)}
          <button
            class="card bg-base-200 hover:bg-base-300 hover:border-primary/50 transition text-left p-4 cursor-pointer border border-base-content/10 flex flex-col justify-between"
            onclick={() => selectExample(example)}
          >
            <div>
              <div class="flex items-start justify-between gap-2 mb-1">
                <div class="font-semibold text-base-content text-sm">
                  {example.name}
                </div>
                <span class="badge badge-xs badge-neutral shrink-0">
                  {example.files.length}
                  {example.files.length === 1 ? "file" : "files"}
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
