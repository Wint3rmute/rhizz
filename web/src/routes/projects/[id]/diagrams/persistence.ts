// Schema + validation for the diagram data persisted into the active
// project's VFS (web/src/routes/projects/[id]/diagrams/+page.svelte's
// `checked`/`savedLayout` — see readDiagramLayoutFile/
// writeDiagramLayoutFile below). Deliberately has zero Svelte/DOM
// dependency, so it can be unit tested directly (see persistence.test.ts)
// without mounting a component.
import { z } from "zod";
import { type ProjectFs, VfsError } from "../../../../vfs/fs";

// Where a node's label is positioned within its box. Structurally
// identical to (and interchangeable with) geometry.ts's `TextAlign` type,
// which stays the canonical type for anything unrelated to persistence
// (e.g. textPosition()'s geometry math) — this schema only needs to agree
// with it on shape, not share a literal import, since both are plain
// string-literal unions.
const TextAlignSchema = z.enum(["center", "top-center", "top-left"]);

// Position + size + style of a node, as stored in checked/savedLayout.
// width/height/textAlign are optional so entries persisted before those
// features existed still parse; see +page.svelte's nodeBox() for the
// backfilled read path.
export const StoredBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  textAlign: TextAlignSchema.optional(),
});

export type StoredBox = z.infer<typeof StoredBoxSchema>;

// Validates a raw, untrusted record (e.g. straight from
// JSON.parse(localStorage.getItem(...))) against StoredBoxSchema,
// dropping any entry that doesn't match instead of letting a
// corrupted/hand-edited/malformed entry propagate NaN/undefined into the
// geometry math downstream. Each entry is parsed independently (rather
// than parsing the whole record as one z.record(...) schema), so one bad
// entry doesn't invalidate the rest of an otherwise-valid record.
export function sanitizeStoredRecord(
  record: Record<string, unknown>,
): Record<string, StoredBox> {
  const sanitized: Record<string, StoredBox> = {};
  let droppedKeys: string[] | null = null;

  for (const [key, value] of Object.entries(record)) {
    const result = StoredBoxSchema.safeParse(value);
    if (result.success) {
      sanitized[key] = result.data;
    } else {
      (droppedKeys ??= []).push(key);
    }
  }

  if (droppedKeys) {
    console.warn(
      `Dropped ${droppedKeys.length} malformed diagram layout entr${
        droppedKeys.length === 1 ? "y" : "ies"
      }: ${droppedKeys.join(", ")}`,
    );
  }

  return sanitized;
}

// A record that isn't guaranteed to be a plain object yet (e.g. straight
// out of JSON.parse) is treated as empty rather than thrown at
// sanitizeStoredRecord, which assumes its input is already at least
// object-shaped.
function sanitizeMaybeRecord(value: unknown): Record<string, StoredBox> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return sanitizeStoredRecord(value as Record<string, unknown>);
}

// Conventional location for diagram layout data inside a project's VFS —
// mirrors how vfs/compile.ts identifies source files by their ".hcl"
// extension, since there's no contentType tag on FsFile to key off (see
// TASKS.md Task 60). Each project can hold any number of named diagrams
// (TASKS.md Task 65), one JSON file per diagram, selectable via a
// FileTree scoped to this directory.
export const DIAGRAM_LAYOUT_DIR = ".rhizz/diagrams";

// The full persisted content of a single diagram: which components are
// currently placed on its canvas, and every component's last-known box
// (even ones currently unchecked) — see +page.svelte's `checked`/
// `savedLayout` for what actually populates these.
export interface DiagramLayout {
  checked: Record<string, StoredBox>;
  savedLayout: Record<string, StoredBox>;
}

export function emptyDiagramLayout(): DiagramLayout {
  return { checked: {}, savedLayout: {} };
}

// Reads and validates a diagram layout file from the project's VFS,
// tolerating everything a hand-edited or pre-existing file could throw at
// it: a missing file (never saved yet — returns an empty layout),
// malformed JSON, a non-object top level, or individually malformed
// entries within `checked`/`savedLayout` (each dropped via
// sanitizeStoredRecord rather than invalidating the whole file).
export async function readDiagramLayoutFile(
  fs: ProjectFs,
  path: string,
): Promise<DiagramLayout> {
  let raw: string;
  try {
    raw = await fs.readFile(path);
  } catch (error) {
    if (error instanceof VfsError && error.code === "ENOENT") {
      return emptyDiagramLayout();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      `Malformed JSON in diagram layout file "${path}"; starting from an empty layout`,
    );
    return emptyDiagramLayout();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn(
      `Unrecognized data shape in diagram layout file "${path}"; starting from an empty layout`,
    );
    return emptyDiagramLayout();
  }

  const record = parsed as Record<string, unknown>;
  return {
    checked: sanitizeMaybeRecord(record.checked),
    savedLayout: sanitizeMaybeRecord(record.savedLayout),
  };
}

// Writes a diagram layout file into the project's VFS, creating
// `.rhizz/diagrams/` first if this is the first diagram ever saved for
// this project.
export async function writeDiagramLayoutFile(
  fs: ProjectFs,
  path: string,
  layout: DiagramLayout,
): Promise<void> {
  await fs.mkdir(DIAGRAM_LAYOUT_DIR, { recursive: true });
  await fs.writeFile(path, JSON.stringify(layout));
}

// --- Task 60 -> Task 65 migration -------------------------------------
//
// Before named diagrams existed (Task 65), a project had at most one
// implicit diagram, stored as two separate flat-record files at these
// fixed paths (Task 60). Kept only so migrateLegacyDiagramFiles() below
// can find and migrate any pre-existing data written under that scheme —
// nothing else in this module should ever read or write them again.
const LEGACY_CHECKED_NODES_PATH = `${DIAGRAM_LAYOUT_DIR}/checked.json`;
const LEGACY_SAVED_LAYOUT_PATH = `${DIAGRAM_LAYOUT_DIR}/saved-layout.json`;

async function readLegacyFlatRecord(
  fs: ProjectFs,
  path: string,
): Promise<Record<string, StoredBox> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path);
  } catch (error) {
    if (error instanceof VfsError && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return sanitizeMaybeRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

// One-time per-project migration: combines any pre-existing
// checked.json/saved-layout.json (Task 60's single-implicit-diagram
// scheme) into a single "main" diagram, then removes the legacy files.
// A no-op (does nothing, touches nothing) once neither legacy file
// exists anymore — which is the case for every project from its very
// first diagrams-page load onward.
export async function migrateLegacyDiagramFiles(fs: ProjectFs): Promise<void> {
  const [legacyChecked, legacySavedLayout] = await Promise.all([
    readLegacyFlatRecord(fs, LEGACY_CHECKED_NODES_PATH),
    readLegacyFlatRecord(fs, LEGACY_SAVED_LAYOUT_PATH),
  ]);
  if (legacyChecked === null && legacySavedLayout === null) return;

  await writeDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/main.json`, {
    checked: legacyChecked ?? {},
    savedLayout: legacySavedLayout ?? {},
  });
  await fs.rm(LEGACY_CHECKED_NODES_PATH, { force: true });
  await fs.rm(LEGACY_SAVED_LAYOUT_PATH, { force: true });
}
