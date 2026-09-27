// A diagram scene is the only input the shared canvas draws. Hosts build one
// (read-only viewers, the modeling page, and later an animation player) and
// the canvas never loads a view, owns the camera, or decides what a pointer
// event means. Node and edge ids are strings so a later tween can keep the
// same DOM node across frames; paint order is the array order, which the
// read-only builder fills from the full parent chain (an unplaced intermediate
// parent still counts toward depth).
import {
  type Box,
  computeRenderOrder,
  type ConnectionOrientation,
  type ConnectionSide,
  type TextAlign,
} from "./geometry";
import type {
  DiagramStaticAnnotation,
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./types";

export type DiagramNodeHandles = "none" | "connect" | "resize" | "both";

export interface DiagramPort {
  label: string;
  role: "provider" | "consumer" | "peer";
  protocol?: string;
}

export interface DiagramNode {
  id: string;
  /** Arena index. Callbacks speak this; `{#each}` keys must not. */
  index: number;
  label: string;
  box: Box & { textAlign: TextAlign };
  parentIndex?: number;
  icon?: string;
  color?: string;
  border?: string;
  font?: string;
  selected: boolean;
  /** Read-only "no detail view" affordance. Not a glow. */
  dimmed: boolean;
  reparentTarget: boolean;
  ports: DiagramPort[];
  handles: DiagramNodeHandles;
  /** 1 while resting. Below 1 only while a transition is fading this node. */
  opacity?: number | undefined;
}

export interface DiagramEdge {
  id: string;
  label: string;
  from: number;
  to: number;
  startSide?: ConnectionSide;
  endSide?: ConnectionSide;
  selected: boolean;
  opacity?: number | undefined;
}

export interface DiagramNote {
  id: string;
  index: number;
  text: string;
  x: number;
  y: number;
  scale: number;
  selected: boolean;
  opacity?: number | undefined;
}

export type DiagramOverlay =
  | { type: "marquee"; box: Box }
  | {
    type: "rubber-band";
    from: { x: number; y: number };
    to: { x: number; y: number };
    orientation: ConnectionOrientation;
  };

export interface DiagramScene {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  notes: DiagramNote[];
  overlays: DiagramOverlay[];
}

export function diagramEdgeId(
  label: string,
  from: number | string,
  to: number | string,
): string {
  return `${label}:${String(from)}:${String(to)}`;
}

export function diagramNoteId(index: number): string {
  return `note-${String(index)}`;
}

function textAlignOf(align: TextAlign | undefined): TextAlign {
  return align ?? "center";
}

function noteOf(
  ann: { text: string; x: number; y: number; scale?: number },
  index: number,
  selected: boolean,
): DiagramNote {
  return {
    id: diagramNoteId(index),
    index,
    text: ann.text,
    x: ann.x,
    y: ann.y,
    scale: ann.scale ?? 1,
    selected,
  };
}

export function buildReadOnlyScene(input: {
  components: DiagramStaticComponent[];
  connections: DiagramStaticConnection[];
  boxes: Record<number, DiagramStaticBox>;
  annotations?: DiagramStaticAnnotation[];
  selected?: ReadonlySet<number>;
  linked?: ReadonlySet<number>;
  /** When set, nodes absent from `linked` are dimmed. Explore/embed pass this only when a click handler exists, matching the old opacity rule. */
  dimUnlinked?: boolean;
  /** Stable component keys, index-aligned. View transitions match on these, not arena indexes. */
  ids?: readonly string[];
}): DiagramScene {
  const selected = input.selected ?? new Set<number>();
  const linked = input.linked ?? new Set<number>();
  const parentOf = (index: number): number | undefined =>
    input.components[index]?.parent_component_index;

  const placed = Object.keys(input.boxes)
    .map(Number)
    .filter((index) => input.components[index] !== undefined);
  const order = computeRenderOrder(placed, parentOf);

  const nodes: DiagramNode[] = order.flatMap((index) => {
    const component = input.components[index];
    const placedBox = input.boxes[index];
    if (!component || !placedBox) return [];
    const node: DiagramNode = {
      id: input.ids?.[index] ?? String(index),
      index,
      label: component.label,
      box: { ...placedBox, textAlign: textAlignOf(placedBox.textAlign) },
      selected: selected.has(index),
      dimmed: input.dimUnlinked === true && !linked.has(index),
      reparentTarget: false,
      ports: [],
      handles: "none",
    };
    if (component.parent_component_index !== undefined) {
      node.parentIndex = component.parent_component_index;
    }
    if (component.icon) node.icon = component.icon;
    if (component.color) node.color = component.color;
    if (component.border) node.border = component.border;
    if (component.font) node.font = component.font;
    return [node];
  });

  return {
    nodes,
    edges: input.connections.map((conn) => {
      const fromKey = input.ids?.[conn.from] ?? String(conn.from);
      const toKey = input.ids?.[conn.to] ?? String(conn.to);
      const edge: DiagramEdge = {
        id: diagramEdgeId(conn.label, fromKey, toKey),
        label: conn.label,
        from: conn.from,
        to: conn.to,
        selected: false,
      };
      if (conn.startSide !== undefined) edge.startSide = conn.startSide;
      if (conn.endSide !== undefined) edge.endSide = conn.endSide;
      return edge;
    }),
    notes: (input.annotations ?? []).map((ann, index) =>
      noteOf(ann, index, false)
    ),
    overlays: [],
  };
}

export interface EditorSceneNodeInput {
  id: string;
  index: number;
  label: string;
  box: Box & { textAlign?: TextAlign | undefined };
  parentIndex?: number | undefined;
  icon?: string | undefined;
  color?: string | undefined;
  border?: string | undefined;
  font?: string | undefined;
  ports?: DiagramPort[] | undefined;
}

export interface EditorSceneEdgeInput {
  label: string;
  from: number;
  to: number;
  /** Stable endpoint keys. View transitions match edges on these, not arena indexes. */
  fromKey?: string | undefined;
  toKey?: string | undefined;
  startSide?: ConnectionSide | undefined;
  endSide?: ConnectionSide | undefined;
}

export function buildEditorScene(input: {
  /** Already in paint order. The page's render order walks the full model, which a scene of only placed nodes cannot reconstruct. */
  nodes: EditorSceneNodeInput[];
  edges: EditorSceneEdgeInput[];
  notes: { text: string; x: number; y: number; scale?: number }[];
  selectedNodeIndexes: ReadonlySet<number>;
  /** `"all"` while a connection drag is active — every node shows side handles. Otherwise the set of indexes that do. Resize handles are always on. */
  connectHandles: ReadonlySet<number> | "all";
  selectedNoteIndexes: ReadonlySet<number>;
  reparentTargetIndex: number | null;
  selectedEdgeLabel: string | null;
  marquee?: Box | null;
  rubberBand?: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    orientation?: ConnectionOrientation;
  } | null;
}): DiagramScene {
  const connectHandles = input.connectHandles;
  const overlays: DiagramOverlay[] = [];
  if (input.marquee) {
    overlays.push({ type: "marquee", box: input.marquee });
  }
  if (input.rubberBand) {
    overlays.push({
      type: "rubber-band",
      from: input.rubberBand.from,
      to: input.rubberBand.to,
      orientation: input.rubberBand.orientation ?? "horizontal",
    });
  }

  return {
    nodes: input.nodes.map((node) => {
      const showConnect = connectHandles === "all" ||
        connectHandles.has(node.index);
      const built: DiagramNode = {
        id: node.id,
        index: node.index,
        label: node.label,
        box: { ...node.box, textAlign: textAlignOf(node.box.textAlign) },
        selected: input.selectedNodeIndexes.has(node.index),
        dimmed: false,
        reparentTarget: node.index === input.reparentTargetIndex,
        ports: node.ports ?? [],
        handles: showConnect ? "both" : "resize",
      };
      if (node.parentIndex !== undefined) built.parentIndex = node.parentIndex;
      if (node.icon) built.icon = node.icon;
      if (node.color) built.color = node.color;
      if (node.border) built.border = node.border;
      if (node.font) built.font = node.font;
      return built;
    }),
    edges: input.edges.map((edge) => {
      const built: DiagramEdge = {
        id: diagramEdgeId(
          edge.label,
          edge.fromKey ?? edge.from,
          edge.toKey ?? edge.to,
        ),
        label: edge.label,
        from: edge.from,
        to: edge.to,
        selected: edge.label === input.selectedEdgeLabel,
      };
      if (edge.startSide !== undefined) built.startSide = edge.startSide;
      if (edge.endSide !== undefined) built.endSide = edge.endSide;
      return built;
    }),
    notes: input.notes.map((note, index) =>
      noteOf(note, index, input.selectedNoteIndexes.has(index))
    ),
    overlays,
  };
}
