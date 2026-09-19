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
//
// The store itself and the "create a project and seed its files" helpers are
// non-reactive and live in ./projects.
import { projectStore } from "./projects";
import type { Project } from "./vfs/types";

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

// Drops the active project (e.g. when leaving all project routes) so
// project-scoped UI — navbar links, badges, the tour button flow — never
// acts on a stale id. Switching projects (A → B) keeps the layout alive
// and re-sets state via the effect above, so this only fires on real exit.
export function clearCurrentProject(): void {
  currentProjectId = null;
  currentProject = null;
  currentScore = null;
  currentDiagnostics = null;
}

// Re-reads the active project's metadata (e.g. after a rename elsewhere)
// without changing which project is active.
export async function refreshCurrentProject(): Promise<void> {
  if (currentProjectId !== null) await setCurrentProject(currentProjectId);
}
</script>
