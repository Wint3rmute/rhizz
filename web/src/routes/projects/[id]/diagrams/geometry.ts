// Pure geometry helpers for the diagrams canvas (web/src/routes/diagrams/
// +page.svelte). Deliberately has zero Svelte/DOM dependency, so it can be
// unit tested directly (see geometry.test.ts) without mounting a component.

// Where a node's label is positioned within its box.
export type TextAlign = "center" | "top-center" | "top-left";

export type Box = { x: number; y: number; width: number; height: number };

// Whether a connection leaves/enters its endpoints horizontally (via the
// left/right side, jogging vertically in the middle — for boxes that are
// mostly side-by-side) or vertically (via the top/bottom side, jogging
// horizontally in the middle — for boxes that are mostly stacked).
export type ConnectionOrientation = "horizontal" | "vertical";
export type ConnectionSide = "top" | "bottom" | "left" | "right";

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
// shrinks into an unusable sliver. Used by clampResizeWithin below.
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

// Clamps a resizing box's width/height so it doesn't grow past `parent`'s
// inner edge, inset by `margin`. Unlike clampWithin, the box's top-left
// corner (x, y) is treated as fixed — resizing always anchors from the
// corner opposite the handle being dragged.
export function clampResizeWithin(
  box: Box,
  parent: Box,
  margin: number,
): { width: number; height: number } {
  const maxWidth = parent.x + parent.width - margin - box.x;
  const maxHeight = parent.y + parent.height - margin - box.y;
  return {
    width: Math.min(box.width, Math.max(MIN_NODE_SIZE, maxWidth)),
    height: Math.min(box.height, Math.max(MIN_NODE_SIZE, maxHeight)),
  };
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
  B extends Box,
>(
  connections: T[],
  getBox: (index: number) => B | null | undefined,
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
    return `M ${x1},${y1} L ${x2},${y2}`;
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
    `M ${x0},${y0}`,
    `L ${x1},${y1}`,
    `A ${rc},${rc} 0 0,${sweep(t1 as 0 | 1)} ${x2},${y2}`,
    `L ${x3},${y3}`,
    `A ${rc},${rc} 0 0,${sweep(t2 as 0 | 1)} ${x4},${y4}`,
    `L ${x5},${y5}`,
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
