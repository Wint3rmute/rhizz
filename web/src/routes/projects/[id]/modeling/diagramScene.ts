// The diagram scene: everything needed to *draw* a diagram, resolved once.
//
// The modeler, Explore, Inventory, the book and the embed each used to build
// this themselves — with three different defaulting rules for node size and
// text alignment, and four separate hand-rolled hit-test candidate loops in
// `+page.svelte` alone. This module is the single implementation.
//
// Deliberately free of Svelte, WASM and DOM: it takes plain data and returns
// plain data, so it unit-tests without a renderer and every host reaches the
// same geometry. Hosts that want to *react* to selection, hover or a marquee
// keep that state themselves and pass it to the renderer — the scene knows
// nothing about interaction.
//
// Components are addressed by `key`, the stable qualified path
// (`drone/rotor`) produced by `Model::component_keys()`, never by arena
// index. Arena indices shift whenever components are inserted or reordered
// earlier in the source, which silently reattaches persisted positions to the
// wrong component; a key only changes when the component is renamed or
// reparented.
import {
  annotationBounds,
  type Box,
  boxBoundaryPoint,
  boxCenter,
  boxContains,
  boxSidePoint,
  computePortPositions,
  type ConnectionOrientation,
  type ConnectionSide,
  elbowPath,
  type PortGeometry,
  type TextAlign,
  unionBox,
} from "./geometry";

/** Default box size for a placed node that predates per-node sizing. */
export const DEFAULT_NODE_WIDTH = 100;
export const DEFAULT_NODE_HEIGHT = 100;
export const DEFAULT_TEXT_ALIGN: TextAlign = "center";

export interface ScenePortInput {
  label: string;
  role: "provider" | "consumer" | "peer";
  protocol?: string;
}

export interface SceneComponentInput {
  /** Stable qualified path, e.g. `"drone/rotor"`. Unique within the scene. */
  key: string;
  label: string;
  /** Qualified path of the parent component, if any. Drives depth + order. */
  parentKey?: string | undefined;
  icon?: string | undefined;
  color?: string | undefined;
  border?: string | undefined;
  font?: string | undefined;
  ports?: readonly ScenePortInput[] | undefined;
}

export interface SceneConnectionInput {
  label: string;
  fromKey: string;
  toKey: string;
  /** Routing override for the `from` endpoint; unset means the router picks. */
  startSide?: ConnectionSide | undefined;
  endSide?: ConnectionSide | undefined;
}

/** A placed node's persisted position, before defaults are applied. */
export interface SceneBoxInput {
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  textAlign?: TextAlign | undefined;
}

export interface SceneAnnotationInput {
  text: string;
  x: number;
  y: number;
  scale?: number | undefined;
}

export interface SceneNode {
  key: string;
  label: string;
  /** Qualified path of the parent, or undefined at the top level. */
  parentKey: string | undefined;
  /** Fully defaulted — no consumer needs to re-apply size/align defaults. */
  box: Box & { textAlign: TextAlign };
  /** Hops to the root. Parents always have a lower depth than their children. */
  depth: number;
  icon?: string | undefined;
  color?: string | undefined;
  border?: string | undefined;
  font?: string | undefined;
  /** Port positions in node-local coordinates (add `box.x/y` for world). */
  ports: PortGeometry[];
}

export interface SceneEdge {
  label: string;
  fromKey: string;
  toKey: string;
  /** Resolved world-space endpoints, as the side-centres the router chose. */
  a: { x: number; y: number };
  b: { x: number; y: number };
  orientation: ConnectionOrientation;
  /** The elbow path `d`, precomputed so no host re-derives routing. */
  d: string;
}

export interface SceneAnnotation {
  text: string;
  x: number;
  y: number;
  scale: number;
  /** The annotation's hit box, so hit-testing and rendering cannot drift. */
  bounds: Box;
}

export interface DiagramScene {
  /** Placed nodes in paint order — parents always before their children. */
  nodes: SceneNode[];
  edges: SceneEdge[];
  annotations: SceneAnnotation[];
  /** Combined node + annotation bounds, for zoom-to-fill. Null when empty. */
  bounds: Box | null;
  byKey: Map<string, SceneNode>;
}

export interface BuildSceneOptions {
  components: readonly SceneComponentInput[];
  connections: readonly SceneConnectionInput[];
  /** Placed nodes keyed by component key. A component absent here isn't drawn. */
  boxes: Readonly<Record<string, SceneBoxInput>>;
  annotations?: readonly SceneAnnotationInput[] | undefined;
  /**
   * Narrows the scene to a subtree or a system. Applied to nodes *and* edges
   * (an edge with a filtered-out endpoint is dropped), so a scoped diagram
   * never shows a line running off to a node that isn't there.
   */
  include?: ((key: string) => boolean) | undefined;
  defaultNodeWidth?: number | undefined;
  defaultNodeHeight?: number | undefined;
}

function depthOf(
  key: string,
  parentOf: (k: string) => string | undefined,
): number {
  let depth = 0;
  let current = parentOf(key);
  const seen = new Set<string>([key]);
  while (current !== undefined) {
    // A malformed model could report a parentKey cycle; stop rather than
    // spin. Resolution rejects those, but this module must not hang.
    if (seen.has(current)) break;
    seen.add(current);
    depth += 1;
    current = parentOf(current);
  }
  return depth;
}

export function buildDiagramScene(options: BuildSceneOptions): DiagramScene {
  const {
    components,
    connections,
    boxes,
    annotations = [],
    include,
    defaultNodeWidth = DEFAULT_NODE_WIDTH,
    defaultNodeHeight = DEFAULT_NODE_HEIGHT,
  } = options;

  const visible = include
    ? components.filter((c) => include(c.key))
    : [...components];

  const parentOf = (key: string): string | undefined => {
    const found = visible.find((c) => c.key === key);
    return found?.parentKey;
  };

  // Build only the placed nodes: a component with no box is not on the canvas,
  // and a box for a key no component claims is stale (deleted or renamed since
  // the layout was written) and must not draw.
  //
  // Iterating `boxes` rather than `components` is deliberate — insertion order
  // decides which of two same-depth siblings paints on top, and the layouts
  // this replaces were both built by iterating their box record.
  const byComponentKey = new Map(visible.map((c) => [c.key, c]));
  const placed: SceneNode[] = [];
  for (const [key, raw] of Object.entries(boxes)) {
    const component = byComponentKey.get(key);
    if (component === undefined) continue;
    const box: Box & { textAlign: TextAlign } = {
      x: raw.x,
      y: raw.y,
      width: raw.width ?? defaultNodeWidth,
      height: raw.height ?? defaultNodeHeight,
      textAlign: raw.textAlign ?? DEFAULT_TEXT_ALIGN,
    };
    placed.push({
      key: component.key,
      label: component.label,
      parentKey: component.parentKey,
      box,
      depth: depthOf(component.key, parentOf),
      icon: component.icon,
      color: component.color,
      border: component.border,
      font: component.font,
      ports: component.ports
        ? computePortPositions(box.width, box.height, component.ports)
        : [],
    });
  }

  // Parents paint before children. `Array.prototype.sort` is stable, so equal
  // depths keep `boxes` insertion order — the same order the hosts had before.
  const nodes = placed.sort((a, b) => a.depth - b.depth);

  const byKey = new Map(nodes.map((n) => [n.key, n]));

  const edges: SceneEdge[] = [];
  for (const connection of connections) {
    const from = byKey.get(connection.fromKey);
    const to = byKey.get(connection.toKey);
    if (from === undefined || to === undefined) continue;
    const routed = routeEndpoints(from, to, connection);
    edges.push({
      label: connection.label,
      fromKey: connection.fromKey,
      toKey: connection.toKey,
      ...routed,
      d: elbowPath(
        routed.a.x,
        routed.a.y,
        routed.b.x,
        routed.b.y,
        routed.orientation,
      ),
    });
  }

  const sceneAnnotations: SceneAnnotation[] = annotations.map((annotation) => ({
    text: annotation.text,
    x: annotation.x,
    y: annotation.y,
    scale: annotation.scale ?? 1,
    bounds: annotationBounds({
      text: annotation.text,
      x: annotation.x,
      y: annotation.y,
      scale: annotation.scale ?? 1,
    }),
  }));

  const all = [
    ...nodes.map((n) => n.box),
    ...sceneAnnotations.map((a) => a.bounds),
  ];
  const bounds = all.length > 0 ? unionBox(all) : null;

  return { nodes, edges, annotations: sceneAnnotations, bounds, byKey };
}

// Resolves an edge's two endpoints and the axis it leaves/enters along.
//
// The orientation is chosen once and used for *both* endpoints, so the two
// sides are always compatible with the elbow that connects them. An explicit
// `startSide`/`endSide` overrides the guess and also fixes the axis.
function routeEndpoints(
  from: SceneNode,
  to: SceneNode,
  connection: SceneConnectionInput,
): {
  a: { x: number; y: number };
  b: { x: number; y: number };
  orientation: ConnectionOrientation;
} {
  const orientationFor = (side: ConnectionSide): ConnectionOrientation =>
    side === "left" || side === "right" ? "horizontal" : "vertical";

  if (connection.startSide !== undefined && connection.endSide !== undefined) {
    return {
      a: boxSidePoint(from.box, connection.startSide),
      b: boxSidePoint(to.box, connection.endSide),
      orientation: orientationFor(connection.startSide),
    };
  }
  if (connection.startSide !== undefined) {
    const orientation = orientationFor(connection.startSide);
    const a = boxSidePoint(from.box, connection.startSide);
    return { a, b: boxBoundaryPoint(to.box, a, orientation), orientation };
  }
  if (connection.endSide !== undefined) {
    const orientation = orientationFor(connection.endSide);
    const b = boxSidePoint(to.box, connection.endSide);
    return { a: boxBoundaryPoint(from.box, b, orientation), b, orientation };
  }
  const fromCenter = boxCenter(from.box);
  const toCenter = boxCenter(to.box);
  const orientation: ConnectionOrientation =
    Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y)
      ? "horizontal"
      : "vertical";
  return {
    a: boxBoundaryPoint(from.box, toCenter, orientation),
    b: boxBoundaryPoint(to.box, fromCenter, orientation),
    orientation,
  };
}

export interface RectQueryResult {
  /** Keys of nodes *fully* enclosed by the rect, in paint order. */
  nodes: string[];
  /** Indices of enclosed annotations. */
  annotations: number[];
}

/**
 * Everything the rect fully encloses — the marquee-selection rule, where a
 * node counts only once its whole bounding box is inside (a partial overlap
 * is not a selection, matching the mental model of other selection tools).
 */
export function queryRect(scene: DiagramScene, rect: Box): RectQueryResult {
  const nodes: string[] = [];
  for (const node of scene.nodes) {
    if (boxContains(rect, node.box)) nodes.push(node.key);
  }
  const annotations: number[] = [];
  scene.annotations.forEach((annotation, index) => {
    if (boxContains(rect, annotation.bounds)) annotations.push(index);
  });
  return { nodes, annotations };
}

export interface ConnectionPick {
  key: string;
  /** The snapped port, or null when the point landed on the node body. */
  port: string | null;
}

/**
 * What a connection drag dropped on. Port handles win over node bodies (they
 * are small and precise), and among several matches the deepest node wins,
 * since children paint on top of their parent.
 */
export function pickConnectionTarget(
  scene: DiagramScene,
  point: { x: number; y: number },
  sourceKey: string,
  portSnapRadius = 15,
): ConnectionPick | null {
  let bestPort:
    | { key: string; port: string; distance: number; depth: number }
    | null = null;
  for (const node of scene.nodes) {
    if (node.key === sourceKey) continue;
    for (const port of node.ports) {
      const distance = Math.hypot(
        point.x - (node.box.x + port.x),
        point.y - (node.box.y + port.y),
      );
      if (distance > portSnapRadius) continue;
      if (
        bestPort === null ||
        distance < bestPort.distance ||
        node.depth > bestPort.depth
      ) {
        bestPort = {
          key: node.key,
          port: port.label,
          distance,
          depth: node.depth,
        };
      }
    }
  }
  if (bestPort !== null) return { key: bestPort.key, port: bestPort.port };

  let bestBox: { key: string; depth: number } | null = null;
  for (const node of scene.nodes) {
    if (node.key === sourceKey) continue;
    if (
      point.x < node.box.x ||
      point.x > node.box.x + node.box.width ||
      point.y < node.box.y ||
      point.y > node.box.y + node.box.height
    ) {
      continue;
    }
    if (bestBox === null || node.depth > bestBox.depth) {
      bestBox = { key: node.key, depth: node.depth };
    }
  }
  return bestBox === null ? null : { key: bestBox.key, port: null };
}

export interface ReparentPickOptions {
  /** Keys that cannot be a drop target (e.g. the current selection). */
  exclude?: readonly string[] | undefined;
  /** The node being dragged. Neither it nor its descendants are valid parents. */
  dragKey?: string | undefined;
}

/**
 * Which container a dragged node would be reparented into: the *deepest* box
 * containing the dragged node's centre, so a node dropped inside a nested
 * component lands in that one rather than in an ancestor that also contains
 * it. Returns null when the centre is in no box (a free drop at top level).
 */
export function pickReparentTarget(
  scene: DiagramScene,
  dragged: Box,
  options: ReparentPickOptions = {},
): string | null {
  const { exclude = [], dragKey } = options;
  const blocked = new Set(exclude);
  if (dragKey !== undefined) {
    // A node can never be its own parent, nor a parent of its own subtree.
    blocked.add(dragKey);
    for (const key of descendantsOf(scene, dragKey)) blocked.add(key);
  }

  const center = boxCenter(dragged);
  let best: string | null = null;
  let maxDepth = -1;
  for (const node of scene.nodes) {
    if (blocked.has(node.key)) continue;
    if (
      center.x < node.box.x ||
      center.x > node.box.x + node.box.width ||
      center.y < node.box.y ||
      center.y > node.box.y + node.box.height
    ) {
      continue;
    }
    if (node.depth > maxDepth) {
      maxDepth = node.depth;
      best = node.key;
    }
  }
  return best;
}

/**
 * Every transitive descendant of `key`, at any depth, in paint order.
 *
 * Reparenting needs this to reject drops that would make a node its own
 * ancestor. A component absent from the scene is a leaf here: the scene only
 * knows about placed nodes, and an unplaced node has no box to drop into.
 */
export function descendantsOf(scene: DiagramScene, key: string): string[] {
  const out: string[] = [];
  const walk = (parentKey: string): void => {
    for (const node of scene.nodes) {
      if (node.parentKey !== parentKey) continue;
      out.push(node.key);
      walk(node.key);
    }
  };
  walk(key);
  return out;
}
