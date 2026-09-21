// Undo/redo content for the diagram canvas, including annotations.
//
// `history.ts` owns the generic bounded stack; this module owns *what* is
// snapshotted: node placement (`checked`/`savedLayout`), connection routing
// overrides, and free-standing text annotations. Annotations are view-level
// metadata persisted in `views/*.hcl` — they must ride the same
// layout-only undo stack as node drags, otherwise add/delete/edit/drag/
// resize of a note can never be undone.
import type { Annotation } from "../../../../rhizz_wasm_wrapper";
import type { StoredBox, StoredConnection } from "./persistence";

export interface DiagramContent {
  checked: Record<string, StoredBox>;
  savedLayout: Record<string, StoredBox>;
  connections: Record<string, StoredConnection>;
  annotations: Annotation[];
}

function cloneBoxes(
  boxes: Record<string, StoredBox>,
): Record<string, StoredBox> {
  return Object.fromEntries(
    Object.entries(boxes).map(([key, box]) => [key, { ...box }]),
  );
}

function cloneConnections(
  connections: Record<string, StoredConnection>,
): Record<string, StoredConnection> {
  return Object.fromEntries(
    Object.entries(connections).map(([key, conn]) => [key, { ...conn }]),
  );
}

function cloneAnnotations(annotations: Annotation[]): Annotation[] {
  return annotations.map((ann) => ({ ...ann }));
}

/** Deep-copies diagram content into an undo-point snapshot. */
export function snapshotDiagramContent(
  content: DiagramContent,
): DiagramContent {
  return {
    checked: cloneBoxes(content.checked),
    savedLayout: cloneBoxes(content.savedLayout),
    connections: cloneConnections(content.connections),
    annotations: cloneAnnotations(content.annotations),
  };
}

/**
 * Restores a snapshot into fresh objects (so the restored state never
 * aliases the stack entry — later edits must not mutate history).
 */
export function applyDiagramSnapshotContent(
  snapshot: DiagramContent,
): DiagramContent {
  return snapshotDiagramContent(snapshot);
}
