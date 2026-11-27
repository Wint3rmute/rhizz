import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import {
  createProjectWithFiles,
  createProjectWithMainFile,
  projectStore,
} from "../ProjectState.svelte";
import { pendTourStart } from "../tour/tourRequest.svelte";
import { toastState } from "../ToastState.svelte";
import {
  type ExampleProject,
  get_empty_project,
} from "../rhizome_wasm_wrapper";
import type { Project } from "../vfs/types";

// Project creation shared by the landing page and the projects list: both
// offer "New project" and an example picker, and both must arm the first-run
// tour the same way.

/** Projects, most recently touched first. */
export async function listProjectsByRecency(): Promise<Project[]> {
  const loaded = await projectStore.listProjects();
  // The store bumps a project's updatedAt on every node mutation (see
  // vfs/operations.ts), so this surfaces whatever was last worked on.
  return loaded.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function openProject(project: Project): Promise<void> {
  await goto(resolve("/projects/[id]/overview", { id: project.id }));
}

// Runs a project change that the store may refuse (a slug that is taken, or an
// unusable address) and turns the refusal into a toast the user can act on.
// Returns the project as it now stands, or null when the action was refused —
// so a caller can skip the navigation that would have followed.
export async function tryProjectChange(
  action: () => Promise<Project>,
): Promise<Project | null> {
  try {
    return await action();
  } catch (error) {
    toastState.show(
      error instanceof Error ? error.message : String(error),
      "error",
    );
    return null;
  }
}

// Shared tail of both creations: the first project ever arms the guided tour
// to open on arrival, then the new project opens.
async function createAndOpen(
  name: string | null,
  create: (name: string) => Promise<Project>,
): Promise<void> {
  if (!name) return;
  const firstEver = (await projectStore.listProjects()).length === 0;
  // A project's address is the slug of its name, so a name whose slug is
  // taken (or unusable) is refused by the store — report it and stay here
  // rather than navigating to a project that doesn't exist.
  const project = await tryProjectChange(() => create(name));
  if (!project) return;
  if (firstEver) pendTourStart();
  await openProject(project);
}

export async function createEmptyProject(): Promise<void> {
  await createAndOpen(prompt("Project name?", "Untitled project"), (name) =>
    createProjectWithMainFile(name, get_empty_project().main_content),
  );
}

export async function createExampleProject(
  example: ExampleProject,
): Promise<void> {
  await createAndOpen(prompt("Project name?", example.name), (name) =>
    createProjectWithFiles(name, example.files),
  );
}
