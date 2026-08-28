// Schema + validation for the diagram data persisted into the active
// project's VFS (web/src/routes/projects/[id]/diagrams/+page.svelte's
// `checked`/`savedLayout`).
// Converts views to/from canonical HCL using rhizz-core's `serialize_views`
// and `parse_views` (backed by hcl-rs).
import { z } from "zod";
import { type ProjectFs, VfsError } from "../../../../vfs/fs";
import {
  type ConnectionLayout,
  type NodeLayout,
  parse_views,
  serialize_views,
  type ViewDefinition,
} from "../../../../rhizz_wasm_wrapper";
import type { Box } from "./geometry";

// Where a node's label is positioned within its box.
export const TextAlignSchema = z.enum(["center", "top-center", "top-left"]);
export type TextAlign = z.infer<typeof TextAlignSchema>;

export const ConnectionSideSchema = z.enum(["top", "bottom", "left", "right"]);
export type ConnectionSide = z.infer<typeof ConnectionSideSchema>;

export const StoredConnectionSchema = z.object({
  startSide: ConnectionSideSchema.optional(),
  endSide: ConnectionSideSchema.optional(),
});
export type StoredConnection = z.infer<typeof StoredConnectionSchema>;

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

// Conventional location for diagram layout data inside a project's VFS.
export const DIAGRAM_LAYOUT_DIR = ".rhizz/diagrams";

// The full persisted content of a single diagram: which components are
// currently placed on its canvas, every component's last-known box, and connection starting points.
export interface DiagramLayout {
  checked: Record<string, StoredBox>;
  savedLayout: Record<string, StoredBox>;
  connections?: Record<string, StoredConnection>;
}

export function emptyDiagramLayout(): DiagramLayout {
  return { checked: {}, savedLayout: {}, connections: {} };
}

/**
 * Minimal structural interface for components needed to resolve hierarchical keys.
 */
export interface ComponentHierarchyItem {
  label: string;
  parent_component_index?: number | undefined;
  parent_system_index?: number | undefined;
}

/**
 * Minimal structural interface for systems needed to resolve hierarchical keys.
 */
export interface SystemHierarchyItem {
  label: string;
}

/**
 * Builds a structurally-stable persistence key for a component: the path
 * of labels from its root system down to it, e.g. "drone/controller/mcu".
 *
 * Falls back to a `#<index>`-prefixed key if the chain can't be resolved.
 */
export function componentKey(
  index: number,
  components: ComponentHierarchyItem[],
  systems: SystemHierarchyItem[],
): string {
  const parts: string[] = [];
  let current: number | undefined = index;

  while (current !== undefined) {
    const component: ComponentHierarchyItem | undefined = components[current];
    if (!component) return `#${index}`;
    parts.unshift(component.label);
    if (component.parent_component_index !== undefined) {
      current = component.parent_component_index;
      continue;
    }
    const system = component.parent_system_index !== undefined
      ? systems[component.parent_system_index]
      : undefined;
    if (system) parts.unshift(system.label);
    current = undefined;
  }

  return parts.join("/");
}

/**
 * Builds a reverse lookup Map from component persistence keys to arena indices.
 */
export function buildKeyToIndexMap(
  components: ComponentHierarchyItem[],
  systems: SystemHierarchyItem[],
): Map<string, number> {
  const map = new Map<string, number>();
  components.forEach((_, index) => {
    map.set(componentKey(index, components, systems), index);
  });
  return map;
}

/**
 * Maps layout checked records to placed node bounding boxes keyed by arena index.
 */
export function mapLayoutToBoxes(
  checked: Record<string, StoredBox>,
  keyToIndex: Map<string, number>,
  defaultWidth = 100,
  defaultHeight = 100,
): Record<number, Box & { textAlign: TextAlign }> {
  const result: Record<number, Box & { textAlign: TextAlign }> = {};
  for (const [key, box] of Object.entries(checked)) {
    const index = keyToIndex.get(key);
    if (index === undefined) continue;
    result[index] = {
      x: box.x,
      y: box.y,
      width: box.width ?? defaultWidth,
      height: box.height ?? defaultHeight,
      textAlign: box.textAlign ?? "center",
    };
  }
  return result;
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
  const nodes = Object.entries(layout.checked).map(([component, box]) => {
    const node: NodeLayout = {
      component,
      x: box.x,
      y: box.y,
    };
    if (box.width !== undefined) node.width = box.width;
    if (box.height !== undefined) node.height = box.height;
    if (box.textAlign !== undefined) node.text_align = box.textAlign;
    return node;
  });

  const connections = Object.entries(layout.connections || {}).map(
    ([connection, data]) => {
      const conn: ConnectionLayout = { connection };
      if (data.startSide !== undefined) conn.start_side = data.startSide;
      if (data.endSide !== undefined) conn.end_side = data.endSide;
      return conn;
    },
  );

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
    connections,
  };

  return serialize_views([viewDef]);
}

/**
 * Converts parsed ViewDefinition objects into a DiagramLayout.
 */
export function viewsToLayout(views: ViewDefinition[]): DiagramLayout {
  const checked: Record<string, StoredBox> = {};
  const savedLayout: Record<string, StoredBox> = {};
  const connections: Record<string, StoredConnection> = {};

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
    for (const conn of view.connections || []) {
      const entry: StoredConnection = {};
      if (conn.start_side) {
        const parsedStart = ConnectionSideSchema.safeParse(conn.start_side);
        if (parsedStart.success) {
          entry.startSide = parsedStart.data;
        }
      }
      if (conn.end_side) {
        const parsedEnd = ConnectionSideSchema.safeParse(conn.end_side);
        if (parsedEnd.success) {
          entry.endSide = parsedEnd.data;
        }
      }
      if (entry.startSide || entry.endSide) {
        connections[conn.connection] = entry;
      }
    }
  }

  return { checked, savedLayout, connections };
}

/**
 * Reads and validates a diagram layout file from the project's VFS.
 * Strictly parses canonical HCL view definitions via `parse_views`.
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

  try {
    const views = parse_views(raw);
    if (Array.isArray(views) && views.length > 0) {
      return viewsToLayout(views);
    }
  } catch {
    // Malformed HCL content
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
