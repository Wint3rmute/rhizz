<script module lang="ts">
// Shared, app-wide "which project is active" state — a module-only file
// (no markup), following the same pattern as ThemeState.svelte/
// KeyboardState.svelte. Any component can import and read the active
// project's id/metadata without prop-drilling (e.g. Navbar, to build
// project-scoped links and show the workspace project's name).
//
// This deliberately only tracks the active project's *metadata*
// (Project, from vfs/types.ts — the workspace container), not its node
// list: pages that need the project's files (editor/diagrams/overview)
// fetch those directly from `projectStore` themselves, so a page's own
// edits are never at risk of being shadowed by a stale cache living here.
import { openProjectFs } from "./vfs/fs";
import { LocalStorageProjectStore } from "./vfs/localStorageStore";
import type { Project } from "./vfs/types";

// The single localStorage-backed VFS for the whole app. Every
// page/component that reads or mutates projects/files goes through this
// same instance.
export const projectStore = new LocalStorageProjectStore();

let currentProjectId = $state<string | null>(null);
let currentProject = $state<Project | null>(null);
let currentScore = $state<{ overall_percentage: number } | null>(null);
let currentDiagnostics = $state<{ errors: number; warnings: number } | null>(
  null,
);

export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

export function getCurrentProject(): Project | null {
  return currentProject;
}

export function getCurrentScore(): { overall_percentage: number } | null {
  return currentScore;
}

export function setCurrentScore(
  score: { overall_percentage: number } | null,
): void {
  currentScore = score;
}

export function getCurrentDiagnostics(): {
  errors: number;
  warnings: number;
} | null {
  return currentDiagnostics;
}

export function setCurrentDiagnostics(
  diags: { errors: number; warnings: number } | null,
): void {
  currentDiagnostics = diags;
}

// Loads `id`'s metadata into the shared reactive state. `currentProject`
// ends up `null` if no project with that id exists (e.g. a stale/bad
// URL) — callers (see routes/projects/[id]/+layout.svelte) are expected
// to show a "not found" fallback in that case rather than rendering
// project-scoped content.
export async function setCurrentProject(id: string): Promise<void> {
  currentProjectId = id;
  currentScore = null;
  currentDiagnostics = null;
  const projects = await projectStore.listProjects();
  const found = projects.find((p) => p.id === id) ?? null;
  // A stale async call (e.g. rapid navigation between two projects)
  // could resolve after a newer one already changed `currentProjectId`
  // — guard against overwriting the newer result with the older one.
  if (currentProjectId === id) currentProject = found;
}

// Re-reads the active project's metadata (e.g. after a rename elsewhere)
// without changing which project is active.
export async function refreshCurrentProject(): Promise<void> {
  if (currentProjectId !== null) await setCurrentProject(currentProjectId);
}

// Creates a project and seeds it with a single root-level "main.hcl"
// file — the interim "one editable file per project" convention until
// Task 58 adds a real file-tree UI. Kept here rather than duplicated at
// each call site (the /projects page's "new project" and "new from
// example" actions).
export async function createProjectWithMainFile(
  name: string,
  content: string,
): Promise<Project> {
  const project = await projectStore.createProject(name);
  await openProjectFs(projectStore, project.id).writeFile(
    "main.hcl",
    content,
  );
  return project;
}

// Creates a project and writes all supplied files into its virtual filesystem.
// Diagram files (e.g. "diagrams/main.hcl") are unpacked exclusively into
// ".rhizz/diagrams/" where diagram views are persisted and discovered,
// avoiding duplicate directory trees.
export async function createProjectWithFiles(
  name: string,
  files: Array<{ path: string; content: string }>,
): Promise<Project> {
  const project = await projectStore.createProject(name);
  const fs = openProjectFs(projectStore, project.id);
  for (const file of files) {
    const targetPath = file.path.startsWith("diagrams/")
      ? `.rhizz/${file.path}`
      : file.path;

    const lastSlash = targetPath.lastIndexOf("/");
    if (lastSlash !== -1) {
      const dir = targetPath.slice(0, lastSlash);
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(targetPath, file.content);
  }
  return project;
}
</script>
