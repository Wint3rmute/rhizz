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

// Conventional location for diagram layout data inside a project's VFS —
// mirrors how vfs/compile.ts identifies source files by their ".hcl"
// extension, since there's no contentType tag on FsFile to key off (see
// TASKS.md Task 60). One JSON file per persisted record (rather than one
// combined file) keeps each file's shape a plain Record<string,
// StoredBox> that this module's own schema already validates, instead of
// inventing a second, combined schema just for storage.
const DIAGRAM_LAYOUT_DIR = ".rhizz/diagrams";
export const CHECKED_NODES_PATH = `${DIAGRAM_LAYOUT_DIR}/checked.json`;
export const SAVED_LAYOUT_PATH = `${DIAGRAM_LAYOUT_DIR}/saved-layout.json`;

// Reads and validates a diagram layout file from the project's VFS,
// tolerating everything a hand-edited or pre-existing file could throw at
// it: a missing file (never saved yet — returns {}), malformed JSON, a
// non-object top level, or individually malformed entries (each dropped
// via sanitizeStoredRecord rather than invalidating the whole file).
export async function readDiagramLayoutFile(
  fs: ProjectFs,
  path: string,
): Promise<Record<string, StoredBox>> {
  let raw: string;
  try {
    raw = await fs.readFile(path);
  } catch (error) {
    if (error instanceof VfsError && error.code === "ENOENT") return {};
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      `Malformed JSON in diagram layout file "${path}"; starting from an empty layout`,
    );
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn(
      `Unrecognized data shape in diagram layout file "${path}"; starting from an empty layout`,
    );
    return {};
  }

  return sanitizeStoredRecord(parsed as Record<string, unknown>);
}

// Writes a diagram layout file into the project's VFS, creating
// `.rhizz/diagrams/` first if this is the first diagram layout ever saved
// for this project.
export async function writeDiagramLayoutFile(
  fs: ProjectFs,
  path: string,
  data: Record<string, StoredBox>,
): Promise<void> {
  await fs.mkdir(DIAGRAM_LAYOUT_DIR, { recursive: true });
  await fs.writeFile(path, JSON.stringify(data));
}
