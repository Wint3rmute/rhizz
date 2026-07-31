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
import {
  CHECKED_NODES_PATH,
  sanitizeStoredRecord,
  SAVED_LAYOUT_PATH,
  writeDiagramLayoutFile,
} from "./routes/projects/[id]/diagrams/persistence";

// The single localStorage-backed VFS for the whole app. Every
// page/component that reads or mutates projects/files goes through this
// same instance.
export const projectStore = new LocalStorageProjectStore();

let currentProjectId = $state<string | null>(null);
let currentProject = $state<Project | null>(null);

export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

export function getCurrentProject(): Project | null {
  return currentProject;
}

// Loads `id`'s metadata into the shared reactive state. `currentProject`
// ends up `null` if no project with that id exists (e.g. a stale/bad
// URL) — callers (see routes/projects/[id]/+layout.svelte) are expected
// to show a "not found" fallback in that case rather than rendering
// project-scoped content.
export async function setCurrentProject(id: string): Promise<void> {
  currentProjectId = id;
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

// One-time migration: before this task, the whole app kept a single
// global HCL string under this localStorage key (see Persisted.svelte.ts
// usage prior to Task 57). Anyone with pre-existing data gets it moved
// into a real project the first time the app loads after this change
// ships, then the legacy key is removed — so this only ever does
// anything once per browser (the `getItem` check below is what makes it
// a no-op on every subsequent load).
const LEGACY_SYSTEM_INPUT_KEY = "SYSTEM_INPUT_BOX";

async function migrateLegacySystemInputBox(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(LEGACY_SYSTEM_INPUT_KEY);
  if (raw === null) return;

  // The legacy value was written by Persisted.svelte.ts, which stores
  // everything as `JSON.stringify(value)` — so a plain HCL string is
  // sitting there JSON-quoted (e.g. `"system \"x\" {}"`), not raw. Parse
  // it back; fall back to the raw value if it's ever not valid JSON (e.g.
  // hand-edited storage), rather than losing the user's data.
  let content = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") content = parsed;
  } catch {
    // keep `raw` as-is
  }

  const project = await createProjectWithMainFile("Migrated project", content);
  localStorage.removeItem(LEGACY_SYSTEM_INPUT_KEY);
  await migrateLegacyDiagramLayout(project.id);
}

// One-time migration (extends the one above): before Task 60, diagram
// layouts lived under these two global localStorage keys — shared by
// every project in the browser, since there was only ever one project
// worth of diagram data before this task. Anyone with pre-existing
// layout data gets it copied into the project just migrated above
// (there's no other project it could sensibly belong to), then the
// legacy keys are removed.
const LEGACY_CHECKED_NODES_KEY = "DIAGRAM_CHECKED_NODES";
const LEGACY_SAVED_LAYOUT_KEY = "DIAGRAM_SAVED_LAYOUT";

async function migrateLegacyDiagramLayout(projectId: string): Promise<void> {
  if (typeof localStorage === "undefined") return;

  const fs = openProjectFs(projectStore, projectId);
  for (
    const [legacyKey, path] of [
      [LEGACY_CHECKED_NODES_KEY, CHECKED_NODES_PATH],
      [LEGACY_SAVED_LAYOUT_KEY, SAVED_LAYOUT_PATH],
    ] as const
  ) {
    const raw = localStorage.getItem(legacyKey);
    if (raw === null) continue;

    let record: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed JSON: treat as if nothing was ever saved.
    }

    await writeDiagramLayoutFile(fs, path, sanitizeStoredRecord(record));
    localStorage.removeItem(legacyKey);
  }
}

if (typeof window !== "undefined") {
  migrateLegacySystemInputBox();
}
</script>
