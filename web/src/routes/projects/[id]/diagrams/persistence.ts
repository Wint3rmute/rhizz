// Schema + validation for the diagram data persisted into the active
// project's VFS (web/src/routes/projects/[id]/diagrams/+page.svelte's
// `checked`/`savedLayout`).
// Converts views to/from canonical HCL using rhizz-core's `serialize_views`
// and `parse_views` (backed by hcl-rs).
import { z } from "zod";
import { type ProjectFs, VfsError } from "../../../../vfs/fs";
import {
  parse_views,
  serialize_views,
  type ViewDefinition,
} from "../../../../rhizz_wasm_wrapper";

// Where a node's label is positioned within its box.
export const TextAlignSchema = z.enum(["center", "top-center", "top-left"]);
export type TextAlign = z.infer<typeof TextAlignSchema>;

// Position + size + style of a node, as stored in checked/savedLayout.
export const StoredBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  textAlign: TextAlignSchema.optional(),
});

export type StoredBox = z.infer<typeof StoredBoxSchema>;

// Validates a raw record against StoredBoxSchema, dropping malformed entries.
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

function sanitizeMaybeRecord(value: unknown): Record<string, StoredBox> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return sanitizeStoredRecord(value as Record<string, unknown>);
}

// Conventional location for diagram layout data inside a project's VFS.
export const DIAGRAM_LAYOUT_DIR = ".rhizz/diagrams";

// The full persisted content of a single diagram: which components are
// currently placed on its canvas, and every component's last-known box.
export interface DiagramLayout {
  checked: Record<string, StoredBox>;
  savedLayout: Record<string, StoredBox>;
}

export function emptyDiagramLayout(): DiagramLayout {
  return { checked: {}, savedLayout: {} };
}

/**
 * Extracts a clean view name from a file path (e.g. ".rhizz/diagrams/overview.hcl" -> "overview").
 */
export function viewNameFromPath(path: string): string {
  const filename = path.split("/").pop() || "diagram";
  return filename.replace(/\.(hcl|json)$/, "");
}

/**
 * Converts a DiagramLayout into a canonical HCL view block using rhizz-core's `serialize_views`.
 */
export function layoutToHcl(
  layout: DiagramLayout,
  viewName = "diagram",
  systemName = "",
): string {
  const nodes = Object.entries(layout.checked).map(([component, box]) => ({
    component,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    text_align: box.textAlign,
  }));

  const viewDef: ViewDefinition = {
    label: viewName,
    description: "",
    tags: [],
    system: systemName,
    filter: {
      include_tags: [],
      exclude_tags: [],
      components: [],
    },
    nodes,
  };

  return serialize_views([viewDef]);
}

/**
 * Converts parsed ViewDefinition objects into a DiagramLayout.
 */
export function viewsToLayout(views: ViewDefinition[]): DiagramLayout {
  const checked: Record<string, StoredBox> = {};
  const savedLayout: Record<string, StoredBox> = {};

  for (const view of views) {
    for (const node of view.nodes || []) {
      const parsedBox = StoredBoxSchema.safeParse({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        textAlign: node.text_align,
      });
      if (parsedBox.success) {
        checked[node.component] = parsedBox.data;
        savedLayout[node.component] = parsedBox.data;
      }
    }
  }

  return { checked, savedLayout };
}

/**
 * Reads and validates a diagram layout file from the project's VFS.
 * Supports canonical HCL format (parsed via `parse_views`) and legacy JSON format.
 */
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

  // 1. Try parsing as HCL view definitions
  try {
    const views = parse_views(raw);
    if (Array.isArray(views) && views.length > 0) {
      return viewsToLayout(views);
    }
  } catch {
    // Not valid HCL or legacy JSON format - proceed to fallback
  }

  // 2. Legacy fallback: JSON parsing
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ) {
      const record = parsed as Record<string, unknown>;
      return {
        checked: sanitizeMaybeRecord(record.checked),
        savedLayout: sanitizeMaybeRecord(record.savedLayout),
      };
    }
  } catch {
    // Malformed JSON / unrecognized format
  }

  return emptyDiagramLayout();
}

/**
 * Writes a diagram layout file into the project's VFS formatted as canonical HCL.
 */
export async function writeDiagramLayoutFile(
  fs: ProjectFs,
  path: string,
  layout: DiagramLayout,
  systemName = "",
): Promise<void> {
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash !== -1 ? path.slice(0, lastSlash) : DIAGRAM_LAYOUT_DIR;
  await fs.mkdir(dir, { recursive: true });

  const viewName = viewNameFromPath(path);
  const hclContent = layoutToHcl(layout, viewName, systemName);
  await fs.writeFile(path, hclContent);
}
