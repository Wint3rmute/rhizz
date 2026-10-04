// Schema + projection for the diagram data persisted into the active
// project's VFS (web/src/routes/projects/[id]/modeling/ModelingPage.svelte's
// `checked`).
// Converts views to/from canonical HCL using rhizz-core's `serialize_views`
// and `parse_views` (backed by hcl-rs). rhizz-core owns parsing and view
// validation, so this module only projects `ViewDefinition` to/from the
// canvas shape.
import { type Dirent, type ProjectFs, VfsError } from "../../../../vfs/fs";
import {
  type Annotation,
  type ConnectionLayout,
  type NodeLayout,
  parse_views,
  serialize_views,
  type ViewDefinition,
} from "../../../../rhizz_wasm_wrapper";
import type { Box, ConnectionSide, TextAlign } from "./geometry";

// Re-export the canvas's alignment/side unions so persistence consumers share
// one definition (`geometry.ts` remains the source of truth).
export type { ConnectionSide, TextAlign } from "./geometry";

export interface StoredConnection {
  startSide?: ConnectionSide | undefined;
  endSide?: ConnectionSide | undefined;
}

// Position + size + style of a node, as stored in `checked`.
export interface StoredBox {
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  textAlign?: TextAlign | undefined;
}

const TEXT_ALIGNS: readonly TextAlign[] = ["center", "top-center", "top-left"];
const CONNECTION_SIDES: readonly ConnectionSide[] = [
  "top",
  "bottom",
  "left",
  "right",
];

/** Narrows a raw HCL `text_align` string to the canvas's alignment union. */
function asTextAlign(value: string | undefined): TextAlign | undefined {
  if (value === undefined) return undefined;
  return TEXT_ALIGNS.find((align) => align === value);
}

/** Narrows a raw HCL connection-side string to the canvas's side union. */
function asConnectionSide(
  value: string | undefined,
): ConnectionSide | undefined {
  if (value === undefined) return undefined;
  return CONNECTION_SIDES.find((side) => side === value);
}

// Conventional location for diagram layout data inside a project's VFS.
export const VIEW_LAYOUT_DIR = "views";

// The persisted content of a single diagram: which system it shows, which
// components are placed on its canvas, connection routing overrides, and
// free-standing text annotations. `system` is immutable after creation — the
// Modeling UI never offers to change it, only the Code editor can (or delete
// + recreate). The editor's "remembered layout" for unchecked nodes is
// transient UI state and is deliberately not persisted (see `ModelingPage.svelte`).
export interface DiagramLayout {
  /** Label of the system this view shows. `""` means unlinked/legacy. */
  system?: string;
  checked: Record<string, StoredBox>;
  connections?: Record<string, StoredConnection>;
  annotations?: Annotation[];
}

export function emptyDiagramLayout(system = ""): DiagramLayout {
  return { system, checked: {}, connections: {}, annotations: [] };
}

/**
 * A layout placing only what the selection holds: the components in
 * `selectedKeys`, each at the box it already has, and the annotations in
 * `selectedNotes` at the position they already have.
 *
 * Positions are copied verbatim rather than re-centered: the selection is
 * already a picture, and moving it would mean the new view and the old one
 * disagree about where things are. Connections need no copying at all — edges
 * are drawn from the model wherever both of their endpoints are placed, so a
 * connection between two selected components comes along by itself.
 */
export function layoutFromSelection(
  system: string,
  checked: Record<string, StoredBox>,
  selectedKeys: Iterable<string>,
  selectedNotes: readonly Annotation[] = [],
): DiagramLayout {
  const layout = emptyDiagramLayout(system);
  for (const key of selectedKeys) {
    const box = checked[key];
    // A selected key with no box is not on the canvas, so it is not in the
    // picture either — same rule `mapLayoutToBoxes` applies to stale keys.
    if (box) layout.checked[key] = { ...box };
  }
  layout.annotations = selectedNotes.map((note) => ({ ...note }));
  return layout;
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
 * Extracts a clean view name from a file path (e.g. "views/overview.hcl" -> "overview").
 */
export function viewNameFromPath(path: string): string {
  const filename = path.split("/").pop() ?? "diagram";
  return filename.replace(/\.(hcl|json)$/, "");
}

/**
 * The path of a new view, relative to `views/`, for the name the user typed.
 *
 * `null` when the name cannot be one: blank, or a nested path. A name is one
 * path segment, since `prompt()` has no place to express nesting — that is the
 * Diagrams tree's `+ Folder`, and `NewViewModal` validates the same way.
 */
export function viewPathFromName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.includes("/")) return null;
  return trimmed.endsWith(".hcl") ? trimmed : `${trimmed}.hcl`;
}

/**
 * Whether a view file already sits at `path`. Writing there would replace it,
 * so the caller asks first — a view is a hand-arranged picture that no
 * confirmation dialog stands between the user and the loss of.
 */
export function viewPathTaken(
  entries: readonly Dirent[],
  path: string,
): boolean {
  return entries.some((entry) => entry.isFile() && entry.path === path);
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

  const connections = Object.entries(layout.connections ?? {}).map(
    ([connection, data]) => {
      const conn: ConnectionLayout = { connection };
      if (data.startSide !== undefined) conn.start_side = data.startSide;
      if (data.endSide !== undefined) conn.end_side = data.endSide;
      return conn;
    },
  );

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty-string systems must fall through, ?? would keep "".
  const resolvedSystem = systemName || layout.system || "";
  const viewDef: ViewDefinition = {
    label: viewName,
    full_name: "",
    tags: [],
    system: resolvedSystem,
    filter: {
      include_tags: [],
      exclude_tags: [],
      components: [],
    },
    nodes,
    connections,
    annotations: (layout.annotations ?? []).map((a) => ({ ...a })),
  };

  return serialize_views([viewDef]);
}

/**
 * Converts parsed ViewDefinition objects into a DiagramLayout.
 */
export function viewsToLayout(views: ViewDefinition[]): DiagramLayout {
  const checked: Record<string, StoredBox> = {};
  const connections: Record<string, StoredConnection> = {};
  const annotations: Annotation[] = [];
  const system = views[0]?.system ?? "";

  for (const view of views) {
    for (const node of view.nodes ?? []) {
      // `parse_views` returns typed values, so no re-validation is needed.
      const box: StoredBox = { x: node.x, y: node.y };
      if (node.width !== undefined) box.width = node.width;
      if (node.height !== undefined) box.height = node.height;
      const textAlign = asTextAlign(node.text_align);
      if (textAlign !== undefined) box.textAlign = textAlign;
      checked[node.component] = box;
    }
    for (const conn of view.connections ?? []) {
      const entry: StoredConnection = {};
      const startSide = asConnectionSide(conn.start_side);
      const endSide = asConnectionSide(conn.end_side);
      if (startSide !== undefined) entry.startSide = startSide;
      if (endSide !== undefined) entry.endSide = endSide;
      if (entry.startSide !== undefined || entry.endSide !== undefined) {
        connections[conn.connection] = entry;
      }
    }
    for (const ann of view.annotations ?? []) {
      // Normalize: scale 1 (the serde default for a missing scale) means the
      // annotation is at the default 100%; drop it so it round-trips as
      // absent, matching how layoutToHcl omits the default.
      const normalized = { ...ann };
      if (normalized.scale === 1) delete normalized.scale;
      annotations.push(normalized);
    }
  }

  return { system, checked, connections, annotations };
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
  const dir = lastSlash !== -1 ? path.slice(0, lastSlash) : VIEW_LAYOUT_DIR;
  await fs.mkdir(dir, { recursive: true });

  const viewName = viewNameFromPath(path);
  const hclContent = layoutToHcl(layout, viewName, systemName);
  const annotationBlocks = (hclContent.match(/annotation \{/g) ?? []).length;
  // Data-loss guard: if annotations exist in memory but the compiled wasm
  // serializer emitted none, the wasm pkg (crates/rhizz-wasm/pkg, a gitignored
  // build artifact) is stale and would silently erase annotations from disk.
  // Abort the write loudly instead of overwriting the file.
  const layoutAnnotationCount = layout.annotations?.length ?? 0;
  if (layoutAnnotationCount > 0 && annotationBlocks === 0) {
    throw new Error(
      `[PERSIST] DATALOSS-GUARD: ${
        String(layoutAnnotationCount)
      } annotation(s) in memory ` +
        `but 0 serialized into ${path}. The compiled rhizz wasm pkg is STALE — ` +
        `rebuild it (wasm-pack build crates/rhizz-wasm --target web --release or ` +
        `\`just build\`), then restart the dev server and hard-refresh the browser.`,
    );
  }
  await fs.writeFile(path, hclContent);
}

// Re-export so consumers/tests can parse canonical views HCL back.
export { type Annotation, parse_views };
