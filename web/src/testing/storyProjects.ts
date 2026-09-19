// Shared Storybook project seeding.
//
// Every page-level story needs a real project in the VFS before it can render,
// and Storybook's vitest add-on registers one `test()` per story *while the
// story module evaluates* — so nothing may await at module scope (a top-level
// `await` races the browser runner's suite bookkeeping; this is the "Vitest
// failed to find the current suite" flake). The contract every story file
// follows, and which these helpers exist to enforce:
//
//   - derive deterministic project ids synchronously at module scope and use
//     them directly in story `args`;
//   - do the async seeding from per-story `loaders`, through this module;
//   - each helper looks the project up by that id and only creates what is
//     missing, so repeated runs — module re-evaluation included — stay
//     idempotent.
//
// Covered by the page stories themselves (Explore, Inventory, Diagrams,
// Navbar), which run in a real browser through the storybook vitest project.
import init from "rhizz";
import {
  createProjectWithFiles,
  populateProjectFiles,
  projectStore,
} from "../projects";
import { get_example_projects } from "../rhizz_wasm_wrapper";
import {
  DIAGRAM_LAYOUT_DIR,
  type DiagramLayout,
  writeDiagramLayoutFile,
} from "../routes/projects/[id]/diagrams/persistence";
import { openProjectFs } from "../vfs/fs";
import type { Project } from "../vfs/types";

/** One of the worked examples compiled into the WASM bundle (see `examples/`). */
export type ExampleId =
  | "apollo-11"
  | "drone"
  | "single-file"
  | "social-media"
  | "software-house"
  | "web-app";

let wasmReady: Promise<unknown> | null = null;

// Memoized: `writeDiagramLayoutFile` (serialize_views) and
// `get_example_projects` both need the WASM module loaded, and every story's
// loader calls in here.
function ensureWasm(): Promise<unknown> {
  wasmReady ??= init();
  return wasmReady;
}

export interface StoryFile {
  path: string;
  content: string;
}

export interface StoryProjectSpec {
  /** Deterministic id; also what the story passes as its `projectId` arg. */
  id: string;
  name: string;
  /** Files to write into the project's VFS (parent directories are created). */
  files?: StoryFile[];
  /** Shorthand for a single `main.hcl`; combined with `files`, not exclusive. */
  hcl?: string;
  /** Diagram layouts, serialized canonically into `diagrams/<key>`. */
  diagrams?: Record<string, DiagramLayout>;
  /**
   * Recreate from scratch on every run instead of reusing an existing
   * project. Needed when the page under test mutates its own project — the
   * diagrams editor seeds and rewrites diagram files on load, and stale
   * localStorage can linger in the shared chromium profile — so a leftover
   * project can't be trusted to still match the fixture.
   */
  hermetic?: boolean;
}

async function findProject(id: string): Promise<Project | undefined> {
  const existing = await projectStore.listProjects();
  return existing.find((project) => project.id === id);
}

async function writeDiagrams(
  projectId: string,
  diagrams: Record<string, DiagramLayout> | undefined,
): Promise<void> {
  if (diagrams === undefined) return;
  const fs = openProjectFs(projectStore, projectId);
  for (const [name, layout] of Object.entries(diagrams)) {
    await writeDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${name}`, layout);
  }
}

/**
 * Creates a story's project, or refreshes an existing one. Files and diagram
 * layouts are (re)written on every run, so a project left mutated by an
 * earlier story still renders the fixture; `hermetic` goes further and drops
 * the project entirely first.
 */
export async function ensureStoryProject(
  spec: StoryProjectSpec,
): Promise<Project> {
  await ensureWasm();

  const existing = await findProject(spec.id);
  if (existing !== undefined && spec.hermetic === true) {
    await projectStore.deleteProject(existing.id);
  }

  const files: StoryFile[] = [
    ...(spec.hcl === undefined
      ? []
      : [{ path: "main.hcl", content: spec.hcl }]),
    ...(spec.files ?? []),
  ];
  const project = existing !== undefined && spec.hermetic !== true
    ? existing
    : await createProjectWithFiles(spec.name, files, spec.id);

  if (existing !== undefined && spec.hermetic !== true && files.length > 0) {
    await populateProjectFiles(openProjectFs(projectStore, project.id), files);
  }
  await writeDiagrams(project.id, spec.diagrams);
  return project;
}

function findExample(example: ExampleId) {
  return get_example_projects().find((candidate) => candidate.id === example);
}

/**
 * Ensures a project seeded from one of the compiled-in worked examples.
 * Resolves `undefined` when the example is missing from the WASM bundle, so a
 * story degrades to its empty state instead of throwing in a loader.
 */
export async function ensureExampleProject(
  id: string,
  name: string,
  example: ExampleId,
): Promise<Project | undefined> {
  await ensureWasm();
  const existing = await findProject(id);
  if (existing !== undefined) return existing;
  const found = findExample(example);
  if (found === undefined) return undefined;
  return createProjectWithFiles(name, found.files, id);
}

/**
 * Re-writes the example's files over an existing project. Separate from
 * {@link ensureExampleProject} because loaders in one array run concurrently:
 * a story that needs a *pristine* fixture chains the two (see
 * {@link seedExampleProject}) rather than racing them.
 */
export async function reseedExampleProject(
  id: string,
  example: ExampleId,
): Promise<void> {
  await ensureWasm();
  const found = findExample(example);
  if (found === undefined) return;
  await populateProjectFiles(openProjectFs(projectStore, id), found.files);
}

/** {@link ensureExampleProject} followed by {@link reseedExampleProject}. */
export async function seedExampleProject(
  id: string,
  name: string,
  example: ExampleId,
): Promise<Project | undefined> {
  const project = await ensureExampleProject(id, name, example);
  if (project === undefined) return undefined;
  await reseedExampleProject(id, example);
  return project;
}
