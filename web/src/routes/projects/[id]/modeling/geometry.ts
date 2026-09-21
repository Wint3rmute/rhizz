// Pure geometry helpers for the diagrams canvas (web/src/routes/views/
// +page.svelte). Deliberately has zero Svelte/DOM dependency, so it can be
// unit tested directly (see geometry.test.ts) without mounting a component.

// Where a node's label is positioned within its box.
export type TextAlign = "center" | "top-center" | "top-left";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Whether a connection leaves/enters its endpoints horizontally (via the
// left/right side, jogging vertically in the middle — for boxes that are
// mostly side-by-side) or vertically (via the top/bottom side, jogging
// horizontally in the middle — for boxes that are mostly stacked).
export type ConnectionOrientation = "horizontal" | "vertical";
export type ConnectionSide = "top" | "bottom" | "left" | "right";

// A view annotation as stored in persisted layouts (the structural subset
// both rhizz-wasm's Annotation and DiagramStaticAnnotation share).
export interface AnnotationLike {
  text: string;
  x: number;
  y: number;
  scale?: number;
}

// Base font size (px at 1x scale) and line step for view annotation text.
// Shared by annotationBounds below and every SVG renderer so metrics,
// hit-testing and the visible text can never drift apart.
export const ANNOTATION_FONT_SIZE = 12;
export const ANNOTATION_LINE_HEIGHT = 16;

// Split annotation text into renderable lines. SVG <text> collapses "\n",
// so renderers must emit one <tspan> per line returned here. Empty lines
// (including a trailing newline) are kept so vertical rhythm is preserved.
export function annotationLines(text: string): string[] {
  return text.split("\n");
}

// Extent box of a view annotation's text, using the same geometry constants
// as the interactive canvas's hit-testing (see annotationHitBox in
// +page.svelte): ~7.5px per char at 1x scale, 16px line height, 14px
// horizontal / 8px vertical padding, 40px minimum width. "Zoom to fill" and
// the static renderers use this so a far-away annotation is never clipped
// out of the fitted viewport.
export function annotationBounds(ann: AnnotationLike): Box {
  const scale = ann.scale ?? 1;
  const lines = annotationLines(ann.text);
  const width = Math.max(
    ...lines.map((l) => l.length * 7.5 * scale + 14),
    40,
  );
  const height = lines.length * ANNOTATION_LINE_HEIGHT * scale + 8;
  return {
    x: ann.x - 4,
    y: ann.y - ANNOTATION_LINE_HEIGHT * scale,
    width,
    height,
  };
}

// Identifies which edge or corner of a node is being dragged for resizing.
export type ResizeHandle =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

// Nodes can't be resized smaller than this (world units), so a node never
// shrinks into an unusable sliver. Used by computeResizedBox below.
export const MIN_NODE_SIZE = 40;

// Inset from a node's edges for the two top-aligned TextAlign variants, in
// world units.
export const TEXT_ALIGN_PADDING = 8;

// Clamps `child`'s position (and, if it doesn't fit, its size) so it stays
// fully inside `parent`, inset by `margin` on all sides (or by `topMargin`
// specifically on top, if given — e.g. to reserve room for the parent's
// own title text, which is rendered near the top of its box; see
// textPosition() below). Used wherever the child's top-left corner is
// free to move (drag, initial placement, cascading after the parent
// moves).
export function clampWithin(
  child: Box,
  parent: Box,
  margin: number,
  topMargin: number = margin,
): Box {
  const innerX = parent.x + margin;
  const innerY = parent.y + topMargin;
  const innerWidth = Math.max(0, parent.width - margin * 2);
  const innerHeight = Math.max(0, parent.height - margin - topMargin);

  const width = Math.min(child.width, innerWidth);
  const height = Math.min(child.height, innerHeight);

  const x = Math.min(Math.max(child.x, innerX), innerX + innerWidth - width);
  const y = Math.min(Math.max(child.y, innerY), innerY + innerHeight - height);

  return { x, y, width, height };
}

// Computes a new bounding box by applying pointer deltas to a specified edge or corner handle.
export function computeResizedBox(
  startBox: Box,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  minSize: number = MIN_NODE_SIZE,
): Box {
  let { x, y, width, height } = startBox;

  // Horizontal resizing
  if (
    handle === "right" ||
    handle === "top-right" ||
    handle === "bottom-right"
  ) {
    width = Math.max(minSize, startBox.width + deltaX);
  } else if (
    handle === "left" ||
    handle === "top-left" ||
    handle === "bottom-left"
  ) {
    const rawWidth = startBox.width - deltaX;
    if (rawWidth < minSize) {
      width = minSize;
      x = startBox.x + (startBox.width - minSize);
    } else {
      width = rawWidth;
      x = startBox.x + deltaX;
    }
  }

  // Vertical resizing
  if (
    handle === "bottom" ||
    handle === "bottom-left" ||
    handle === "bottom-right"
  ) {
    height = Math.max(minSize, startBox.height + deltaY);
  } else if (
    handle === "top" ||
    handle === "top-left" ||
    handle === "top-right"
  ) {
    const rawHeight = startBox.height - deltaY;
    if (rawHeight < minSize) {
      height = minSize;
      y = startBox.y + (startBox.height - minSize);
    } else {
      height = rawHeight;
      y = startBox.y + deltaY;
    }
  }

  return { x, y, width, height };
}

// Bounding box (union) enclosing every box in `boxes`. Used to find a
// multi-selection's combined extent for group-resize.
export function unionBox(boxes: Box[]): Box {
  if (boxes.length === 0) {
    // Math.min/max of an empty array is +/-Infinity, which would silently
    // produce NaN/Infinity geometry instead of a clear failure — every
    // current call site already guards against calling this with no
    // boxes, so reaching here indicates a bug at the call site.
    throw new Error("unionBox: boxes must be non-empty");
  }
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

export interface VisibleConnection<T> {
  conn: T;
  a: { x: number; y: number };
  b: { x: number; y: number };
  orientation: ConnectionOrientation;
}

// Computes the anchor point on a specific border side of `box`.
export function boxSidePoint(
  box: Box,
  side: ConnectionSide,
): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: box.x + box.width / 2, y: box.y };
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height };
    case "left":
      return { x: box.x, y: box.y + box.height / 2 };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height / 2 };
  }
}

// Computes boundary connection points and orientation for visible connections
// between placed node boxes.
export function computeVisibleConnections<
  T extends {
    from: number;
    to: number;
    startSide?: ConnectionSide;
    endSide?: ConnectionSide;
  },
>(
  connections: T[],
  getBox: (index: number) => Box | null | undefined,
): VisibleConnection<T>[] {
  return connections.flatMap((conn) => {
    const boxA = getBox(conn.from);
    const boxB = getBox(conn.to);
    if (!boxA || !boxB) return [];

    if (conn.startSide && conn.endSide) {
      const a = boxSidePoint(boxA, conn.startSide);
      const b = boxSidePoint(boxB, conn.endSide);
      const orientation: ConnectionOrientation =
        conn.startSide === "left" || conn.startSide === "right"
          ? "horizontal"
          : "vertical";
      return [{ conn, a, b, orientation }];
    }

    if (conn.startSide) {
      const a = boxSidePoint(boxA, conn.startSide);
      const orientation: ConnectionOrientation =
        conn.startSide === "left" || conn.startSide === "right"
          ? "horizontal"
          : "vertical";
      const b = boxBoundaryPoint(boxB, a, orientation);
      return [{ conn, a, b, orientation }];
    }

    if (conn.endSide) {
      const b = boxSidePoint(boxB, conn.endSide);
      const orientation: ConnectionOrientation =
        conn.endSide === "left" || conn.endSide === "right"
          ? "horizontal"
          : "vertical";
      const a = boxBoundaryPoint(boxA, b, orientation);
      return [{ conn, a, b, orientation }];
    }

    const centerA = boxCenter(boxA);
    const centerB = boxCenter(boxB);
    const orientation: ConnectionOrientation =
      Math.abs(centerB.x - centerA.x) >= Math.abs(centerB.y - centerA.y)
        ? "horizontal"
        : "vertical";
    const a = boxBoundaryPoint(boxA, centerB, orientation);
    const b = boxBoundaryPoint(boxB, centerA, orientation);
    return [{ conn, a, b, orientation }];
  });
}

// Whether `inner` lies fully inside `outer`. Used for marquee-select: a
// node is only selected once its entire bounding box is enclosed by the
// marquee rectangle, not merely overlapping it — the mental model users
// expect from most selection tools.
export function boxContains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// Maps a text alignment + node size to the label <text>'s x/y/anchor/
// baseline. The two top-aligned variants are inset by TEXT_ALIGN_PADDING
// from the node's edges.
export function textPosition(
  align: TextAlign,
  width: number,
  height: number,
): { x: number; y: number; anchor: string; baseline: string } {
  switch (align) {
    case "top-center":
      return {
        x: width / 2,
        y: TEXT_ALIGN_PADDING,
        anchor: "middle",
        baseline: "hanging",
      };
    case "top-left":
      return {
        x: TEXT_ALIGN_PADDING,
        y: TEXT_ALIGN_PADDING,
        anchor: "start",
        baseline: "hanging",
      };
    case "center":
      return {
        x: width / 2,
        y: height / 2,
        anchor: "middle",
        baseline: "middle",
      };
  }
}

// Returns the centre point of a box.
export function boxCenter(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Icon placement inside a node, in node-local coordinates. `size` is the
// rendered width *and* height (the glyph's own aspect ratio is preserved by
// the nested <svg>'s viewBox).
export interface NodeIconPlacement {
  x: number;
  y: number;
  size: number;
}

export interface NodeTextPlacement {
  x: number;
  y: number;
  anchor: string;
  baseline: string;
}

/** Where a node's icon and label go, in node-local coordinates. */
export interface NodeLabelLayout {
  /** `null` when the node has no icon. */
  icon: NodeIconPlacement | null;
  text: NodeTextPlacement;
}

// Insets/sizes of the icon+label block, in world units. The top-aligned
// variants sit in a row along the node's top edge; "center" stacks the icon
// above the label in the middle of the box.
const ICON_INSET = 8;
const ICON_SIZE_TOP = 14;
const ICON_SIZE_CENTER = 18;
const ICON_LABEL_GAP = 4;
const CENTER_ICON_LIFT = 20;
const CENTER_LABEL_DROP = 10;
// Rough average advance of one label glyph, used to estimate the label's
// rendered width so the top-center icon+label row can be centered as a unit.
const LABEL_GLYPH_WIDTH = 7.5;

/**
 * Computes where a node's icon and label are drawn for a given text
 * alignment. Pure so the interactive canvas and the static/embed renderers
 * can't drift apart, and so the placement rules are unit-testable without a
 * DOM.
 *
 * `label` is only needed for the "top-center" alignment, which centers the
 * icon *and* the estimated label width as one row; every other placement
 * depends only on the box size.
 */
export function nodeLabelLayout(
  align: TextAlign,
  label: string,
  width: number,
  height: number,
  hasIcon: boolean,
): NodeLabelLayout {
  if (!hasIcon) {
    return { icon: null, text: textPosition(align, width, height) };
  }

  switch (align) {
    case "top-left":
      return {
        icon: { x: ICON_INSET, y: ICON_INSET, size: ICON_SIZE_TOP },
        text: {
          x: ICON_INSET + ICON_SIZE_TOP + ICON_LABEL_GAP,
          y: TEXT_ALIGN_PADDING,
          anchor: "start",
          baseline: "hanging",
        },
      };
    case "top-center": {
      const estimatedWidth = Math.min(
        width - 2 * ICON_INSET,
        label.length * LABEL_GLYPH_WIDTH + ICON_SIZE_TOP + ICON_LABEL_GAP,
      );
      const startX = Math.max(ICON_INSET, (width - estimatedWidth) / 2);
      return {
        icon: { x: startX, y: ICON_INSET, size: ICON_SIZE_TOP },
        text: {
          x: startX + ICON_SIZE_TOP + ICON_LABEL_GAP,
          y: TEXT_ALIGN_PADDING,
          anchor: "start",
          baseline: "hanging",
        },
      };
    }
    case "center":
      return {
        icon: {
          x: width / 2 - ICON_SIZE_CENTER / 2,
          y: height / 2 - CENTER_ICON_LIFT,
          size: ICON_SIZE_CENTER,
        },
        text: {
          x: width / 2,
          y: height / 2 + CENTER_LABEL_DROP,
          anchor: "middle",
          baseline: "middle",
        },
      };
  }
}

// Returns the midpoint of the side of `box` facing `towards`, for the
// given orientation: the box's left/right-centre if horizontal, or its
// top/bottom-centre if vertical. Both endpoints of a connection are always
// resolved with the *same* orientation (decided once from the two boxes'
// centres, by the caller) so the chosen side is consistent with the elbow
// shape connecting them.
export function boxBoundaryPoint(
  box: Box,
  towards: { x: number; y: number },
  orientation: ConnectionOrientation,
): { x: number; y: number } {
  const center = boxCenter(box);
  if (orientation === "horizontal") {
    const sign = towards.x >= center.x ? 1 : -1;
    return { x: center.x + sign * (box.width / 2), y: center.y };
  }
  const sign = towards.y >= center.y ? 1 : -1;
  return { x: center.x, y: center.y + sign * (box.height / 2) };
}

// Builds an SVG path with a straight/rounded-elbow route between two
// points that always leaves/enters along `orientation`'s axis —
// "horizontal" produces a horizontal-vertical-horizontal (H-V-H) jog,
// "vertical" produces a vertical-horizontal-vertical (V-H-V) jog. Falls
// back to a straight line when the two points are already aligned on the
// jog axis (no bend needed).
//
// Both variants share one abstract shape, built in terms of a "primary"
// axis p (the leave/enter direction) and "secondary" axis s (the jog
// direction); only the final p/s -> x/y mapping differs. Swapping which
// physical axis is p vs s is a reflection, which reverses the handedness
// of the rounded corners, so the arc sweep-flags are flipped for the
// vertical variant to keep corners rounding the correct way.
export function elbowPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  orientation: ConnectionOrientation,
  r = 10,
): string {
  const horizontal = orientation === "horizontal";
  const toXY = (p: number, s: number): [number, number] =>
    horizontal ? [p, s] : [s, p];
  const sweep = (flag: 0 | 1): 0 | 1 =>
    horizontal ? flag : ((1 - flag) as 0 | 1);

  const [ap, as_] = horizontal ? [ax, ay] : [ay, ax];
  const [bp, bs] = horizontal ? [bx, by] : [by, bx];
  const dp = bp - ap;
  const ds = bs - as_;

  if (Math.abs(ds) < 0.5) {
    const [x1, y1] = toXY(ap, as_);
    const [x2, y2] = toXY(bp, bs);
    return `M ${String(x1)},${String(y1)} L ${String(x2)},${String(y2)}`;
  }

  const mp = (ap + bp) / 2;
  const rc = Math.min(r, Math.abs(dp) / 2, Math.abs(ds) / 2);
  const sp = dp >= 0 ? 1 : -1;
  const ss = ds >= 0 ? 1 : -1;
  const t1 = dp * ds > 0 ? 1 : 0;
  const t2 = 1 - t1;

  const [x0, y0] = toXY(ap, as_);
  const [x1, y1] = toXY(mp - sp * rc, as_);
  const [x2, y2] = toXY(mp, as_ + ss * rc);
  const [x3, y3] = toXY(mp, bs - ss * rc);
  const [x4, y4] = toXY(mp + sp * rc, bs);
  const [x5, y5] = toXY(bp, bs);

  return [
    `M ${String(x0)},${String(y0)}`,
    `L ${String(x1)},${String(y1)}`,
    `A ${String(rc)},${String(rc)} 0 0,${String(sweep(t1))} ${String(x2)},${
      String(y2)
    }`,
    `L ${String(x3)},${String(y3)}`,
    `A ${String(rc)},${String(rc)} 0 0,${String(sweep(t2 as 0 | 1))} ${
      String(x4)
    },${String(y4)}`,
    `L ${String(x5)},${String(y5)}`,
  ].join(" ");
}

// Number of parent hops from the model root to `index`, following
// `parentOf` (typically `(i) => components[i]?.parent_component_index`).
// Takes a lookup function rather than the component array directly so this
// stays independent of the reactive `components` derived value.
export function depthOf(
  index: number,
  parentOf: (index: number) => number | undefined,
): number {
  let depth = 0;
  let current = parentOf(index);
  while (current !== undefined) {
    depth += 1;
    current = parentOf(current);
  }
  return depth;
}

// Orders placed component indices shallowest-first so parents are painted
// before their children.
export function computeRenderOrder(
  placedIndices: number[],
  parentOf: (index: number) => number | undefined,
): number[] {
  return [...placedIndices].sort(
    (a, b) => depthOf(a, parentOf) - depthOf(b, parentOf),
  );
}

// Determines which candidate container box (if any) the dragged node should be reparented into.
// Returns the candidate index with the highest depth that contains the dragged box's center,
// or null if none match.
export function findReparentTarget(
  draggedBox: Box,
  candidates: { index: number; box: Box; depth: number }[],
): number | null {
  const center = boxCenter(draggedBox);
  let bestIndex: number | null = null;
  let maxDepth = -1;

  for (const { index, box, depth } of candidates) {
    const containsCenter = center.x >= box.x &&
      center.x <= box.x + box.width &&
      center.y >= box.y &&
      center.y <= box.y + box.height;

    if (containsCenter && depth > maxDepth) {
      maxDepth = depth;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export interface PortGeometry {
  label: string;
  role: "provider" | "consumer" | "peer";
  protocol?: string;
  x: number;
  y: number;
}

// Computes relative (x, y) coordinates for ports around a node's border.
// - Consumers on the left border
// - Providers on the right border
// - Peers on the bottom border
export function computePortPositions(
  width: number,
  height: number,
  ports: {
    label: string;
    role: "provider" | "consumer" | "peer";
    protocol?: string;
  }[],
): PortGeometry[] {
  const providers = ports.filter((p) => p.role === "provider");
  const consumers = ports.filter((p) => p.role === "consumer");
  const peers = ports.filter(
    (p) => p.role !== "provider" && p.role !== "consumer",
  );

  const result: PortGeometry[] = [];

  consumers.forEach((p, i) => {
    result.push({
      ...p,
      x: 0,
      y: ((i + 1) * height) / (consumers.length + 1),
    });
  });

  providers.forEach((p, i) => {
    result.push({
      ...p,
      x: width,
      y: ((i + 1) * height) / (providers.length + 1),
    });
  });

  peers.forEach((p, i) => {
    result.push({
      ...p,
      x: ((i + 1) * width) / (peers.length + 1),
      y: height,
    });
  });

  return result;
}

export interface DirectionalHandle {
  side: ConnectionSide;
  x: number;
  y: number;
}

// Computes 4 connection handle positions (top, right, bottom, left border midpoints)
export function computeDirectionalHandles(
  width: number,
  height: number,
): DirectionalHandle[] {
  return [
    { side: "top", x: width / 2, y: 0 },
    { side: "right", x: width, y: height / 2 },
    { side: "bottom", x: width / 2, y: height },
    { side: "left", x: 0, y: height / 2 },
  ];
}

/** One node resize hit-area: which handle it drives, its box, and its cursor. */
export interface ResizeHandleRect {
  handle: ResizeHandle;
  /** CSS cursor for this handle's drag direction. */
  cursor: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Computes the 8 transparent resize hit-areas around a node — 4 edge strips
// and 4 corner squares — in node-local coordinates (the caller renders them
// inside the node's own `translate(x, y)` group). Edge strips are inset by
// `cornerSize` so they never overlap the corners; every rect is at least 1
// unit long so a degenerate node still has something to grab.
export function computeResizeHandles(
  width: number,
  height: number,
  cornerSize: number,
  edgeThickness: number,
): ResizeHandleRect[] {
  const half = cornerSize / 2;
  const t = edgeThickness / 2;
  const edgeLengthX = Math.max(1, width - 2 * cornerSize);
  const edgeLengthY = Math.max(1, height - 2 * cornerSize);
  return [
    // Edges.
    {
      handle: "top",
      cursor: "ns-resize",
      x: cornerSize,
      y: -t,
      width: edgeLengthX,
      height: edgeThickness,
    },
    {
      handle: "bottom",
      cursor: "ns-resize",
      x: cornerSize,
      y: height - t,
      width: edgeLengthX,
      height: edgeThickness,
    },
    {
      handle: "left",
      cursor: "ew-resize",
      x: -t,
      y: cornerSize,
      width: edgeThickness,
      height: edgeLengthY,
    },
    {
      handle: "right",
      cursor: "ew-resize",
      x: width - t,
      y: cornerSize,
      width: edgeThickness,
      height: edgeLengthY,
    },
    // Corners.
    {
      handle: "top-left",
      cursor: "nwse-resize",
      x: -half,
      y: -half,
      width: cornerSize,
      height: cornerSize,
    },
    {
      handle: "top-right",
      cursor: "nesw-resize",
      x: width - half,
      y: -half,
      width: cornerSize,
      height: cornerSize,
    },
    {
      handle: "bottom-left",
      cursor: "nesw-resize",
      x: -half,
      y: height - half,
      width: cornerSize,
      height: cornerSize,
    },
    {
      handle: "bottom-right",
      cursor: "nwse-resize",
      x: width - half,
      y: height - half,
      width: cornerSize,
      height: cornerSize,
    },
  ];
}

export interface ConnectTargetCandidate {
  index: number;
  box: Box;
  depth: number;
  ports: { label: string; x: number; y: number }[];
}

// Determines the target component and optional port under the cursor when dropping a connection.
// Prioritizes specific port handles first, followed by the deepest (topmost nested) component box.
export function findConnectTarget(
  point: { x: number; y: number },
  sourceIndex: number,
  candidates: ConnectTargetCandidate[],
  portSnapRadius = 15,
): { compIndex: number; portLabel: string | null } | null {
  // Pass 1: Check if cursor is directly over a specific port
  let bestPortHit: {
    compIndex: number;
    portLabel: string;
    distance: number;
    depth: number;
  } | null = null;

  for (const candidate of candidates) {
    if (candidate.index === sourceIndex) continue;
    for (const port of candidate.ports) {
      const worldX = candidate.box.x + port.x;
      const worldY = candidate.box.y + port.y;
      const dist = Math.hypot(point.x - worldX, point.y - worldY);
      if (dist <= portSnapRadius) {
        if (
          !bestPortHit ||
          dist < bestPortHit.distance ||
          candidate.depth > bestPortHit.depth
        ) {
          bestPortHit = {
            compIndex: candidate.index,
            portLabel: port.label,
            distance: dist,
            depth: candidate.depth,
          };
        }
      }
    }
  }

  if (bestPortHit) {
    return {
      compIndex: bestPortHit.compIndex,
      portLabel: bestPortHit.portLabel,
    };
  }

  // Pass 2: Check which component box contains the point, picking the deepest (topmost) component
  let bestBoxHit: { compIndex: number; depth: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.index === sourceIndex) continue;
    const { box, depth, index } = candidate;
    if (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    ) {
      if (!bestBoxHit || depth > bestBoxHit.depth) {
        bestBoxHit = { compIndex: index, depth };
      }
    }
  }

  if (bestBoxHit) {
    return { compIndex: bestBoxHit.compIndex, portLabel: null };
  }

  return null;
}

export interface LcaConnectionEndpoints {
  lcaScopePath: string;
  from: string;
  to: string;
}

// Computes the Lowest Common Ancestor (LCA) scope path and the relative `from` and `to`
// endpoint strings for connecting two components across any hierarchy level.
export function computeLcaConnection(
  srcKey: string,
  sourcePortLabel: string | null,
  targetKey: string,
  targetPortLabel: string | null,
): LcaConnectionEndpoints | null {
  const srcParts = srcKey.split("/").filter(Boolean);
  const targetParts = targetKey.split("/").filter(Boolean);

  if (srcParts.length === 0 || targetParts.length === 0) return null;
  if (srcParts[0] !== targetParts[0]) {
    // Cross-system connections are not supported
    return null;
  }

  // Find longest common prefix length
  let prefixLen = 0;
  while (
    prefixLen < srcParts.length &&
    prefixLen < targetParts.length &&
    srcParts[prefixLen] === targetParts[prefixLen]
  ) {
    prefixLen++;
  }

  const lcaScopePath = srcParts.slice(0, prefixLen).join("/");

  const fromRelParts = srcParts.slice(prefixLen);
  const toRelParts = targetParts.slice(prefixLen);

  const fromComp = fromRelParts.join("/");
  const toComp = toRelParts.join("/");

  const from = sourcePortLabel
    ? (fromComp ? `${fromComp}/${sourcePortLabel}` : sourcePortLabel)
    : fromComp;

  const to = targetPortLabel
    ? (toComp ? `${toComp}/${targetPortLabel}` : targetPortLabel)
    : toComp;

  return {
    lcaScopePath,
    from,
    to,
  };
}
