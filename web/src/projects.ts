// Non-reactive project plumbing: which `ProjectStore` backend the app uses,
// and the "create a project and seed its files" helpers every entry point
// (the Projects page, the navbar's tour flow, Storybook seeding) shares.
//
// Deliberately a plain `.ts` module — nothing here is reactive. Keeping it out
// of `ProjectState.svelte` means plain-`.ts` consumers (tests, story helpers,
// `example_system.ts`) can import it without dragging in a Svelte module, and
// so without the `any` typing typescript-eslint's projectService falls back
// to for `.svelte` imports.
import { openProjectFs } from "./vfs/fs";
import { LocalStorageProjectStore, ServerProjectStore } from "./vfs/vfsStore";
import type { ProjectStore } from "./vfs/store";
import type { Project } from "./vfs/types";

// Storage backend switch: with VITE_RHIZZ_SERVER_URL set, the whole VFS
// persists through the rhizz-server HTTP API; without it (the default),
// everything stays in the browser via localStorage. Build-time env var —
// e.g. `VITE_RHIZZ_SERVER_URL=http://localhost:3000 deno run build`.
const serverUrl = import.meta.env.VITE_RHIZZ_SERVER_URL as string | undefined;

export const projectStore: ProjectStore = serverUrl
  ? new ServerProjectStore(serverUrl)
  : new LocalStorageProjectStore();

/** A file to write into a project's virtual filesystem. */
export interface ProjectFile {
  path: string;
  content: string;
}

// Populates a project's virtual filesystem with a list of relative files.
// Automatically creates parent directories as needed. Diagram files (e.g.
// "diagrams/main.hcl") live at the project root under `diagrams/`.
export async function populateProjectFiles(
  fs: ReturnType<typeof openProjectFs>,
  files: ProjectFile[],
): Promise<void> {
  for (const file of files) {
    const lastSlash = file.path.lastIndexOf("/");
    if (lastSlash !== -1) {
      await fs.mkdir(file.path.slice(0, lastSlash), { recursive: true });
    }
    await fs.writeFile(file.path, file.content);
  }
}

// Creates a project and writes all supplied files into its virtual filesystem.
export async function createProjectWithFiles(
  name: string,
  files: ProjectFile[],
  id?: string,
): Promise<Project> {
  const project = await projectStore.createProject(name, id);
  await populateProjectFiles(openProjectFs(projectStore, project.id), files);
  return project;
}

// Creates a project seeded with a single root-level "main.hcl" — the interim
// "one editable file per project" convention until a real file-tree UI lands.
// Kept here rather than duplicated at each call site (the /projects page's
// "new project" and "new from example" actions).
export async function createProjectWithMainFile(
  name: string,
  content: string,
  id?: string,
): Promise<Project> {
  return createProjectWithFiles(name, [{ path: "main.hcl", content }], id);
}
