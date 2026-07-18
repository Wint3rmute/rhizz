<script lang="ts">
import {
  clamp_zoom,
  get_editor_state,
  reset_view,
} from "../../ViewEditorState.svelte";
import { isModifierHeld } from "../../KeyboardState.svelte";
import { compile_system } from "../../rhizz_wasm_wrapper";
import persisted from "../../Persisted.svelte";

const editor_state = get_editor_state();
let root_svg: SVGElement;

// Tracks the canvas's rendered pixel size so the SVG viewBox can match it
// exactly (1 SVG unit == 1 pixel), keeping the canvas filling all
// available space with no letterboxing regardless of viewport size.
let canvas_width = $state(800);
let canvas_height = $state(600);

// Background grid spacing, in world (SVG) units. MAJOR_GRID_SPACING
// matches the node size (100x100), so the grid doubles as a snapping
// guide; MINOR_GRID_SPACING subdivides each major cell into tenths.
//
// TODO: spacing is fixed, so at extreme zoom the grid can get too dense
// (zoomed out) or too sparse (zoomed in). If that becomes an issue, make
// spacing adaptive: derive a multiplier from editor_state.view.zoom,
// snapped to a "nice" progression (1, 2, 5, 10, 20, 50, ...) so that
// MINOR_GRID_SPACING * zoom stays within a target pixel range (e.g.
// 8-40px), and feed the result into the pattern's width/height and the
// minorGridLines offsets below instead of the constants.
const MAJOR_GRID_SPACING = 100;
const MINOR_GRID_SPACING = 10;
const minorGridLines = Array.from(
  { length: MAJOR_GRID_SPACING / MINOR_GRID_SPACING - 1 },
  (_, i) => (i + 1) * MINOR_GRID_SPACING,
);

let input = persisted("SYSTEM_INPUT_BOX", "# Your input goes here");
let output = $derived.by(() =>
  compile_system([{ filename: "all.hcl", content: input.value }])
);
let model = $derived(output.model());
let components = $derived(model ? model.components() : []);
let connections = $derived(model ? model.connections() : []);

// Default node size, in world (SVG) units, for newly-placed nodes and for
// backfilling entries persisted before per-node sizing existed.
const DEFAULT_NODE_WIDTH = 100;
const DEFAULT_NODE_HEIGHT = 100;

// Nodes can't be resized smaller than this (world units), so a node never
// shrinks into an unusable sliver.
const MIN_NODE_SIZE = 40;

// How many world units position/size snap to when "snap to grid" (below)
// is enabled. Kept as its own constant, separate from MINOR_GRID_SPACING,
// so it can be tuned independently — e.g. exposed as a UI-selectable
// multiplier later.
const SNAP_GRID_SIZE = 10;

// Whether dragging/resizing snaps position/size to SNAP_GRID_SIZE-unit
// increments. Toggled via the "Snap to Grid" button; not persisted — it's
// a transient editing mode, not part of the saved diagram.
let snapEnabled = $state(false);

// Whether snapping is actually in effect right now: either the toggle is
// on, or the modifier key (Ctrl/Cmd) is currently held as a quick
// temporary override. A $derived (rather than inlining the check into
// snap()) so the "Snap to Grid" button can also reflect the live
// modifier-key override, not just the persistent toggle.
let snapActive = $derived(snapEnabled || isModifierHeld());

// Rounds `value` to the nearest multiple of SNAP_GRID_SIZE, or returns it
// unchanged when snapping is off.
function snap(value: number): number {
  return snapActive
    ? Math.round(value / SNAP_GRID_SIZE) * SNAP_GRID_SIZE
    : value;
}

// Size of the resize-handle square rendered at a selected node's
// bottom-right corner, in world units. Its outer corner is rounded to
// match the node's own `rx` so it hugs the node's rounded corner instead
// of poking past it.
const RESIZE_HANDLE_SIZE = 10;
const RESIZE_HANDLE_RADIUS = 5;

// Where a node's label is positioned within its box.
type TextAlign = "center" | "top-center" | "top-left";
const DEFAULT_TEXT_ALIGN: TextAlign = "center";

// Inset from a node's edges for the two top-aligned variants, in world units.
const TEXT_ALIGN_PADDING = 8;

// Stores position + size + style of each checked element, keyed by the
// component's arena index (its position in model.components(), same index
// space as ConnectionJS.from/to and ComponentJS.parent_component_index).
// Component labels are only unique within a parent scope (SPEC.md §2.3), so
// labels cannot be used as a stable key once components are nested. If an
// element is unchecked, it's not present here. Persisted so the diagram
// layout survives page reloads. width/height/textAlign are optional in
// storage so entries persisted before those features existed still parse;
// see nodeBox() for the backfilled read path.
let checked = persisted<
  Record<
    number,
    {
      x: number;
      y: number;
      width?: number;
      height?: number;
      textAlign?: TextAlign;
    }
  >
>("DIAGRAM_CHECKED_NODES", {});

// Returns the placed node's box (position + size + text alignment), or null
// if the component isn't currently checked. Backfills width/height/
// textAlign with defaults for entries persisted before those features were
// introduced.
function nodeBox(index: number): {
  x: number;
  y: number;
  width: number;
  height: number;
  textAlign: TextAlign;
} | null {
  const pos = checked.value[index];
  if (!pos) return null;
  return {
    x: pos.x,
    y: pos.y,
    width: pos.width ?? DEFAULT_NODE_WIDTH,
    height: pos.height ?? DEFAULT_NODE_HEIGHT,
    textAlign: pos.textAlign ?? DEFAULT_TEXT_ALIGN,
  };
}

// Sets the text alignment of the currently selected node. Only meaningful
// (and only exposed in the UI) when exactly one node is selected.
function setSelectedTextAlign(align: TextAlign) {
  if (primarySelected === null) return;
  const box = checked.value[primarySelected];
  if (!box) return;
  checked.value[primarySelected] = { ...box, textAlign: align };
}

// Padding kept between a child node's edges and its active parent's edges,
// in world units.
const CHILD_CONTAINMENT_MARGIN = 10;

type Box = { x: number; y: number; width: number; height: number };

// Returns the box of `index`'s parent component, but only if that parent is
// itself currently placed on the canvas ("active") — a node with a parent
// that isn't on canvas has nothing to be constrained by. Only considers the
// direct parent (see TASKS.md Task 36 for why deeper/transitive containment
// is explicitly out of scope).
function activeParentBox(index: number): ReturnType<typeof nodeBox> | null {
  const parentIndex = components[index]?.parent_component_index;
  if (parentIndex === undefined) return null;
  return nodeBox(parentIndex);
}

// Clamps `child`'s position (and, if it doesn't fit, its size) so it stays
// fully inside `parent`, inset by `margin` on all sides. Pure — does not
// read or write `checked`. Used wherever the child's top-left corner is free
// to move (drag, initial placement, cascading after the parent moves).
function clampWithin(child: Box, parent: Box, margin: number): Box {
  const innerX = parent.x + margin;
  const innerY = parent.y + margin;
  const innerWidth = Math.max(0, parent.width - margin * 2);
  const innerHeight = Math.max(0, parent.height - margin * 2);

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
function clampResizeWithin(
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

// Re-clamps every currently-placed direct child of `parentIndex` against
// the parent's current box. Called after a parent is dragged or resized so
// its children's constraint region follows it live, and after checking a
// new component (in case it's a parent of already-placed children).
function reclampChildren(parentIndex: number) {
  const parentBox = nodeBox(parentIndex);
  if (!parentBox) return;
  components.forEach((component, childIndex) => {
    if (component.parent_component_index !== parentIndex) return;
    const box = nodeBox(childIndex);
    if (!box) return; // not currently placed on canvas
    const clamped = clampWithin(box, parentBox, CHILD_CONTAINMENT_MARGIN);
    checked.value[childIndex] = { ...checked.value[childIndex], ...clamped };
  });
}

// Bounding box (union) enclosing every box in `boxes`. Used to find a
// multi-selection's combined extent for group-resize.
function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

// Whether `inner` lies fully inside `outer`. Used for marquee-select: a
// node is only selected once its entire bounding box is enclosed by the
// marquee rectangle, not merely overlapping it — the mental model users
// expect from most selection tools.
function boxContains(outer: Box, inner: Box): boolean {
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
function textPosition(
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

// Currently selected nodes (component arena indices). Not persisted —
// selection is transient UI state. Always reassigned as a fresh Set on
// change (never mutated in place): plain Set mutations aren't deeply
// tracked by Svelte's $state the way plain object/array mutations are, so
// every change below constructs a new Set to trigger reactivity.
let selected: Set<number> = $state(new Set());

// The single selected node, or null if zero or more than one are selected.
// Used wherever an operation only makes sense for exactly one node (the
// inspector's details/text-alignment controls).
let primarySelected = $derived(
  selected.size === 1 ? [...selected][0] : null,
);
let selectedComponent = $derived(
  primarySelected !== null ? components[primarySelected] ?? null : null,
);
let selectedBox = $derived(
  primarySelected !== null ? nodeBox(primarySelected) : null,
);

// Node-drag state. Dragging any selected node moves the whole selection
// together: startPositions snapshots every selected node's position when
// the drag begins; each move event recomputes every node's position from
// its own snapshot plus the same delta the anchor (grabbed) node moved by,
// so the group moves rigidly with no incremental drift.
let dragging: {
  anchorIndex: number;
  offsetX: number;
  offsetY: number;
  startPositions: Record<number, { x: number; y: number }>;
} | null = $state(null);

// Node-resize state. Resizing any selected node's handle scales the whole
// selection together, proportionally, around the fixed top-left corner of
// the selection's combined bounding box (groupBox, captured at resize
// start alongside every selected node's starting box).
let resizing: {
  anchorIndex: number;
  groupBox: Box;
  startBoxes: Record<number, Box>;
} | null = $state(null);

// Canvas-pan state (screen-space pointer position of the last move event).
// Started by the middle mouse button, anywhere on the canvas (including
// over a node).
let panning: { lastX: number; lastY: number } | null = $state(null);

// Marquee-select state: start point + current point, in world (SVG)
// coordinates. Started by dragging the left mouse button over empty
// canvas.
type MarqueeState = { startX: number; startY: number; x: number; y: number };
let marquee: MarqueeState | null = $state(null);
let marqueeBox: Box | null = $derived.by(() => {
  if (!marquee) return null;
  const m: MarqueeState = marquee;
  return {
    x: Math.min(m.startX, m.x),
    y: Math.min(m.startY, m.y),
    width: Math.abs(m.x - m.startX),
    height: Math.abs(m.y - m.startY),
  };
});

function svgPoint(
  svg: SVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const pt = (svg as SVGSVGElement).createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = (svg as SVGSVGElement).getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

// Middle mouse button always pans, regardless of what's under the
// cursor — including directly over a node, so it must be handled here too
// (not just in onCanvasMouseDown, which only sees clicks on empty canvas).
function onNodeMouseDown(event: MouseEvent, index: number) {
  if (event.button === 1) {
    event.preventDefault();
    panning = { lastX: event.clientX, lastY: event.clientY };
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();

  // Clicking a node that isn't already part of the selection replaces the
  // selection with just that node. Clicking a node that's already
  // selected (as part of a multi-selection) keeps the whole selection, so
  // dragging it moves the whole group.
  if (!selected.has(index)) {
    selected = new Set([index]);
  }

  const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
  const startPositions: Record<number, { x: number; y: number }> = {};
  for (const i of selected) {
    const box = checked.value[i];
    if (box) startPositions[i] = { x: box.x, y: box.y };
  }
  const anchorStart = startPositions[index] ?? { x: 0, y: 0 };
  dragging = {
    anchorIndex: index,
    offsetX: svgCoords.x - anchorStart.x,
    offsetY: svgCoords.y - anchorStart.y,
    startPositions,
  };
}

function onCanvasMouseDown(event: MouseEvent) {
  if (event.button === 1) {
    event.preventDefault();
    panning = { lastX: event.clientX, lastY: event.clientY };
    return;
  }
  if (event.button !== 0) return;

  // Left-drag on empty canvas starts a marquee selection; the actual
  // selection change happens on mouseup, once the drag's extent is known
  // (see onSvgMouseUp).
  const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
  marquee = {
    startX: svgCoords.x,
    startY: svgCoords.y,
    x: svgCoords.x,
    y: svgCoords.y,
  };
}

// Starts a resize of the whole current selection. Stops propagation so the
// handle's own mousedown doesn't also bubble up to the node's onmousedown
// (which would start a drag too). Handles only render on selected nodes
// (see the ViewNode snippet), so `index` is always already in `selected`.
function onResizeHandleMouseDown(event: MouseEvent, index: number) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const startBoxes: Record<number, Box> = {};
  for (const i of selected) {
    const box = nodeBox(i);
    if (box) startBoxes[i] = box;
  }
  const groupBox = unionBox(Object.values(startBoxes));
  resizing = { anchorIndex: index, groupBox, startBoxes };
}

function onSvgMouseMove(event: MouseEvent) {
  if (dragging) {
    const anchorStart = dragging.startPositions[dragging.anchorIndex];
    const anchorBox = nodeBox(dragging.anchorIndex);
    if (anchorStart && anchorBox) {
      const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
      let anchorNext: Box = {
        x: snap(svgCoords.x - dragging.offsetX),
        y: snap(svgCoords.y - dragging.offsetY),
        width: anchorBox.width,
        height: anchorBox.height,
      };
      const anchorParentBox = activeParentBox(dragging.anchorIndex);
      if (anchorParentBox) {
        anchorNext = clampWithin(
          anchorNext,
          anchorParentBox,
          CHILD_CONTAINMENT_MARGIN,
        );
      }
      // The whole selection moves by the same delta the anchor (grabbed)
      // node moved by, recomputed from each node's own start snapshot each
      // event (not accumulated incrementally) to avoid drift.
      const deltaX = anchorNext.x - anchorStart.x;
      const deltaY = anchorNext.y - anchorStart.y;

      for (const [indexStr, start] of Object.entries(dragging.startPositions)) {
        const index = Number(indexStr);
        const box = nodeBox(index);
        if (!box) continue;
        let next: Box = {
          x: start.x + deltaX,
          y: start.y + deltaY,
          width: box.width,
          height: box.height,
        };
        // Each node still respects its own active-parent containment
        // individually — if only some of the selection is constrained,
        // the group may not move perfectly rigidly, but no node is ever
        // allowed to escape its parent's box.
        const ownParentBox = activeParentBox(index);
        if (ownParentBox) {
          next = clampWithin(next, ownParentBox, CHILD_CONTAINMENT_MARGIN);
        }
        checked.value[index] = { ...checked.value[index], ...next };
        reclampChildren(index);
      }
    }
    return;
  }
  if (resizing) {
    const anchorStart = resizing.startBoxes[resizing.anchorIndex];
    if (anchorStart) {
      const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
      const rawWidth = Math.max(MIN_NODE_SIZE, svgCoords.x - anchorStart.x);
      const rawHeight = Math.max(MIN_NODE_SIZE, svgCoords.y - anchorStart.y);
      // Group-resize is a uniform scale (derived from how much the grabbed
      // node's own box changed) applied to every selected node's position
      // (relative to the selection's fixed top-left, groupBox) and size.
      // Unlike single-node resize, this does not enforce parent
      // containment — scaling several nodes while respecting potentially
      // different constraints per node is a lot more complex, and not
      // needed at this project stage.
      const scaleX = rawWidth / anchorStart.width;
      const scaleY = rawHeight / anchorStart.height;

      for (const [indexStr, startBox] of Object.entries(resizing.startBoxes)) {
        const index = Number(indexStr);
        const relX = startBox.x - resizing.groupBox.x;
        const relY = startBox.y - resizing.groupBox.y;
        const next = {
          x: snap(resizing.groupBox.x + relX * scaleX),
          y: snap(resizing.groupBox.y + relY * scaleY),
          width: snap(Math.max(MIN_NODE_SIZE, startBox.width * scaleX)),
          height: snap(Math.max(MIN_NODE_SIZE, startBox.height * scaleY)),
        };
        checked.value[index] = { ...checked.value[index], ...next };
      }
    }
    return;
  }
  if (panning) {
    const dxScreen = event.clientX - panning.lastX;
    const dyScreen = event.clientY - panning.lastY;
    const zoom = editor_state.view.zoom;
    editor_state.view.x -= dxScreen / zoom;
    editor_state.view.y -= dyScreen / zoom;
    panning = { lastX: event.clientX, lastY: event.clientY };
    return;
  }
  if (marquee) {
    const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
    marquee = { ...marquee, x: svgCoords.x, y: svgCoords.y };
  }
}

function onSvgMouseUp() {
  dragging = null;
  resizing = null;
  panning = null;
  if (marquee) {
    // A marquee with negligible size is just a click: clear the selection
    // (matches the old "click empty canvas to deselect" behavior).
    // Otherwise, commit whatever the live preview (marqueeCandidates) was
    // already showing.
    const box = marqueeBox;
    selected = box && (box.width > 2 || box.height > 2)
      ? new Set(marqueeCandidates)
      : new Set();
    marquee = null;
  }
}

// Zooms in/out on the mouse wheel, keeping the point under the cursor
// visually fixed while the rest of the canvas scales around it.
function onWheel(event: WheelEvent) {
  event.preventDefault();
  const zoom = editor_state.view.zoom;
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newZoom = clamp_zoom(zoom * factor);
  if (newZoom === zoom) return;

  const mouseSvg = svgPoint(root_svg, event.clientX, event.clientY);
  const oldWidth = canvas_width / zoom;
  const oldHeight = canvas_height / zoom;
  const fracX = (mouseSvg.x - editor_state.view.x) / oldWidth;
  const fracY = (mouseSvg.y - editor_state.view.y) / oldHeight;

  const newWidth = canvas_width / newZoom;
  const newHeight = canvas_height / newZoom;

  editor_state.view.zoom = newZoom;
  editor_state.view.x = mouseSvg.x - fracX * newWidth;
  editor_state.view.y = mouseSvg.y - fracY * newHeight;
}

// Returns the centre point of a box.
function boxCenter(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Whether a connection leaves/enters its endpoints horizontally (via the
// left/right side, jogging vertically in the middle — for boxes that are
// mostly side-by-side) or vertically (via the top/bottom side, jogging
// horizontally in the middle — for boxes that are mostly stacked).
type ConnectionOrientation = "horizontal" | "vertical";

// Returns the midpoint of the side of `box` facing `towards`, for the
// given orientation: the box's left/right-centre if horizontal, or its
// top/bottom-centre if vertical. Both endpoints of a connection are always
// resolved with the *same* orientation (decided once from the two boxes'
// centres, see visibleConnections below) so the chosen side is consistent
// with the elbow shape connecting them.
function boxBoundaryPoint(
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
function elbowPath(
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
  const sweep = (flag: 0 | 1): 0 | 1 => (horizontal ? flag : ((1 - flag) as 0 | 1));

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

// Only connections where both endpoints are currently on the canvas.
// conn.from/conn.to are already component arena indices, matching the same
// index space `checked` is keyed by. Endpoints are anchored to each box's
// boundary (the edge facing the other node), not its centre, so the arrow
// terminates on the node's perimeter instead of passing into its interior.
// Orientation is decided once from the raw centre-to-centre delta (not
// either box's own aspect ratio) so both endpoints — and the elbow shape
// joining them — always agree on the same horizontal/vertical choice.
let visibleConnections = $derived(
  connections.flatMap((conn) => {
    const boxA = nodeBox(conn.from);
    const boxB = nodeBox(conn.to);
    if (!boxA || !boxB) return [];
    const centerA = boxCenter(boxA);
    const centerB = boxCenter(boxB);
    const orientation: ConnectionOrientation =
      Math.abs(centerB.x - centerA.x) >= Math.abs(centerB.y - centerA.y)
        ? "horizontal"
        : "vertical";
    const a = boxBoundaryPoint(boxA, centerB, orientation);
    const b = boxBoundaryPoint(boxB, centerA, orientation);
    return [{ conn, a, b, orientation }];
  }),
);

// Number of parent_component_index hops from the model root to `index`.
function depthOf(index: number): number {
  let depth = 0;
  let current = components[index]?.parent_component_index;
  while (current !== undefined) {
    depth += 1;
    current = components[current]?.parent_component_index;
  }
  return depth;
}

// Indices of currently-placed nodes, ordered shallowest-first so parents
// are always painted before their children — otherwise a child could end
// up visually hidden behind its parent's fill, depending on arbitrary
// arena order.
let renderOrder = $derived(
  Object.keys(checked.value)
    .map(Number)
    .sort((a, b) => depthOf(a) - depthOf(b)),
);

// Nodes that would be selected if the marquee were released right now —
// i.e. nodes whose full bounding box is enclosed by the marquee rectangle.
// Drives the live selection preview while dragging; committed as-is by
// onSvgMouseUp once the mouse is released.
let marqueeCandidates: Set<number> = $derived.by(() => {
  if (!marqueeBox) return new Set();
  const box = marqueeBox;
  const candidates = new Set<number>();
  for (const index of renderOrder) {
    const box2 = nodeBox(index);
    if (box2 && boxContains(box, box2)) candidates.add(index);
  }
  return candidates;
});
</script>

<div class="flex flex-row flex-1 w-full overflow-hidden">
  <!--
    Left sidebar: inspector for the selected node. Always rendered (even
    with nothing selected) so it keeps a fixed w-64 slot in this flex row.
    Toggling it in/out of the DOM would resize the canvas column next to it
    (since it's flex-1), which changes canvas_width/canvas_height and jumps
    the whole viewBox on every selection change.
  -->
  <aside
    class="w-64 shrink-0 bg-base-100 text-base-content p-4 overflow-y-auto border-r border-base-300"
  >
    <h3
      class="font-semibold text-sm mb-3 text-base-content/70 uppercase tracking-wide"
    >
      Inspector
    </h3>

    {#if selected.size > 1}
      <p class="text-sm text-base-content/70">
        {selected.size} components selected.
      </p>
      <p class="text-sm text-base-content/50 mt-1">
        Drag any of them to move the whole selection, or drag a handle to
        resize the whole selection proportionally.
      </p>
    {:else if selectedComponent}
      <div class="font-semibold truncate" title={selectedComponent.label}>
        {selectedComponent.label}
      </div>
      {#if selectedComponent.description}
        <p class="text-sm text-base-content/60 mt-1">
          {selectedComponent.description}
        </p>
      {/if}

      <div class="divider my-3"></div>

      <div class="text-xs font-semibold text-base-content/70 uppercase tracking-wide mb-2">
        Text alignment
      </div>
      <div class="join w-full">
        <button
          class="btn btn-xs join-item flex-1 {selectedBox?.textAlign ===
            'center'
            ? 'btn-primary'
            : 'btn-ghost'}"
          onclick={() => setSelectedTextAlign("center")}
        >
          Center
        </button>
        <button
          class="btn btn-xs join-item flex-1 {selectedBox?.textAlign ===
            'top-center'
            ? 'btn-primary'
            : 'btn-ghost'}"
          onclick={() => setSelectedTextAlign("top-center")}
        >
          Top
        </button>
        <button
          class="btn btn-xs join-item flex-1 {selectedBox?.textAlign ===
            'top-left'
            ? 'btn-primary'
            : 'btn-ghost'}"
          onclick={() => setSelectedTextAlign("top-left")}
        >
          Top-left
        </button>
      </div>
    {:else}
      <p class="text-base-content/50 text-sm">
        Select a component on the canvas to edit its properties.
      </p>
    {/if}
  </aside>

  <!-- Main canvas -->
  <div class="flex flex-col flex-1 min-w-0">
    <div
      class="relative flex-1 w-full h-full bg-neutral"
      bind:clientWidth={canvas_width}
      bind:clientHeight={canvas_height}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svg
        bind:this={root_svg}
        version="1.1"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="{editor_state.view.x} {editor_state.view
                    .y} {canvas_width / editor_state.view.zoom} {canvas_height /
                    editor_state.view.zoom}"
        onmousemove={onSvgMouseMove}
        onmouseup={onSvgMouseUp}
        onmouseleave={onSvgMouseUp}
        onwheel={onWheel}
        style="cursor: {dragging || resizing || panning
          ? 'grabbing'
          : marquee
            ? 'crosshair'
            : 'grab'}"
      >
        <defs>
          <!--
            World-space grid: patternUnits="userSpaceOnUse" ties the tile to
            the same coordinate system as nodes/connections, so it pans and
            zooms for free via the SVG's own viewBox transform — no JS math
            needed. The tile is sized to the major spacing (100 units, same
            as a node) and draws the minor lines inside it plus one bold
            line on its own edge, which tiles seamlessly into the major grid.
          -->
          <pattern
            id="Grid"
            width={MAJOR_GRID_SPACING}
            height={MAJOR_GRID_SPACING}
            patternUnits="userSpaceOnUse"
          >
            {#each minorGridLines as i}
              <line
                x1={i}
                y1="0"
                x2={i}
                y2={MAJOR_GRID_SPACING}
                stroke="white"
                stroke-opacity="0.08"
                stroke-width="1"
              />
              <line
                x1="0"
                y1={i}
                x2={MAJOR_GRID_SPACING}
                y2={i}
                stroke="white"
                stroke-opacity="0.08"
                stroke-width="1"
              />
            {/each}
            <line
              x1="0"
              y1="0"
              x2={MAJOR_GRID_SPACING}
              y2="0"
              stroke="white"
              stroke-opacity="0.2"
              stroke-width="1"
            />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={MAJOR_GRID_SPACING}
              stroke="white"
              stroke-opacity="0.2"
              stroke-width="1"
            />
          </pattern>
          <marker
            id="arrow"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              fill="white"
              fill-opacity="0.5"
            />
          </marker>
        </defs>
        <rect
          fill="url(#Grid)"
          x={editor_state.view.x}
          y={editor_state.view.y}
          width={canvas_width / editor_state.view.zoom}
          height={canvas_height / editor_state.view.zoom}
          onmousedown={onCanvasMouseDown}
        />

        {#snippet ViewNode(
          label: string,
          index: number,
          x: number,
          y: number,
          width: number,
          height: number,
          textAlign: TextAlign,
        )}
          {@const textPos = textPosition(textAlign, width, height)}
          {@const highlighted = marquee
            ? marqueeCandidates.has(index)
            : selected.has(index)}
          <g
            transform="translate({x}, {y})"
            onmousedown={(e) => onNodeMouseDown(e, index)}
            style="cursor: grab"
          >
            <rect
              {width}
              {height}
              rx="5"
              stroke={highlighted ? "var(--color-primary)" : "white"}
              stroke-width={highlighted ? 2 : 1}
              fill="var(--color-base-200)"
            />
            <text
              x={textPos.x}
              y={textPos.y}
              fill="white"
              text-anchor={textPos.anchor}
              dominant-baseline={textPos.baseline}
              style="pointer-events: none; user-select: none"
            >
              {label}
            </text>
            {#if selected.has(index)}
              <!--
                Only the outer (bottom-right) corner is rounded, matching
                the node's own rx, so the handle hugs the node's rounded
                corner instead of poking past it. rect's rx rounds all four
                corners uniformly, so a path with a single arc is used
                instead of a rect.
              -->
              <path
                d="M {width - RESIZE_HANDLE_SIZE},{height -
                  RESIZE_HANDLE_SIZE} L {width},{height - RESIZE_HANDLE_SIZE}
                  L {width},{height - RESIZE_HANDLE_RADIUS}
                  A {RESIZE_HANDLE_RADIUS},{RESIZE_HANDLE_RADIUS} 0 0,1 {width -
                  RESIZE_HANDLE_RADIUS},{height} L {width -
                  RESIZE_HANDLE_SIZE},{height} Z"
                fill="var(--color-primary)"
                style="cursor: nwse-resize"
                onmousedown={(e) => onResizeHandleMouseDown(e, index)}
              />
            {/if}
          </g>
        {/snippet}

        {#each renderOrder as index}
          {@const box = nodeBox(index)}
          {@const component = components[index]}
          {#if box && component}
            {@render ViewNode(
              component.label,
              index,
              box.x,
              box.y,
              box.width,
              box.height,
              box.textAlign,
            )}
          {/if}
        {/each}

        <!--
          Connections are drawn after (on top of) nodes so arrows/labels are
          never hidden behind an opaque node fill — this can occasionally
          mean a connection line visually crosses over an unrelated node if
          its route happens to pass through it, which is an accepted
          trade-off for now (proper edge routing that dodges nodes entirely
          is a bigger feature, not needed at this stage).
        -->
        {#each visibleConnections as { conn, a, b, orientation }}
          <path
            d={elbowPath(a.x, a.y, b.x, b.y, orientation)}
            stroke="white"
            stroke-opacity="0.35"
            stroke-width="1.5"
            fill="none"
            marker-end="url(#arrow)"
            style="pointer-events: none"
          />
          <text
            x={(a.x + b.x) / 2}
            y={(a.y + b.y) / 2 - 6}
            fill="white"
            fill-opacity="0.5"
            font-size="10"
            text-anchor="middle"
            style="pointer-events: none; user-select: none"
          >
            {conn.label}
          </text>
        {/each}

        {#if marqueeBox}
          <rect
            x={marqueeBox.x}
            y={marqueeBox.y}
            width={marqueeBox.width}
            height={marqueeBox.height}
            fill="var(--color-primary)"
            fill-opacity="0.15"
            stroke="var(--color-primary)"
            stroke-width="1"
            style="pointer-events: none"
          />
        {/if}
      </svg>

      <div class="absolute bottom-2 right-2 z-10 flex gap-2">
        <button
          onclick={() => (snapEnabled = !snapEnabled)}
          class="btn btn-sm {snapActive ? 'btn-primary' : 'btn-ghost'}"
          title="Snap dragging/resizing to a {SNAP_GRID_SIZE}-unit grid — or hold Ctrl/Cmd to snap temporarily"
        >
          Snap to Grid
        </button>
        <button
          onclick={reset_view}
          class="btn btn-ghost btn-sm"
          title="Reset pan and zoom"
        >
          Reset View
        </button>
      </div>
    </div>
  </div>

  <!-- Right sidebar: component list -->
  <aside
    class="w-64 shrink-0 bg-base-100 text-base-content p-4 overflow-y-auto border-l border-base-300"
  >
    <h3
      class="font-semibold text-sm mb-3 text-base-content/70 uppercase tracking-wide"
    >
      Components
    </h3>

    {#if components.length === 0}
      <p class="text-base-content/50 text-sm">
        No components found.<br />Open the editor and define some systems.
      </p>
    {:else}
      <ul class="space-y-1">
        {#each components as component, index}
          <li class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              id="comp-{index}"
              class="checkbox checkbox-xs"
              checked={!!checked.value[index]}
              onchange={(value) => {
                if (value.currentTarget.checked) {
                  let box: Box = {
                    x: 100,
                    y: 100,
                    width: DEFAULT_NODE_WIDTH,
                    height: DEFAULT_NODE_HEIGHT,
                  };
                  const parentBox = activeParentBox(index);
                  if (parentBox) {
                    box = clampWithin(box, parentBox, CHILD_CONTAINMENT_MARGIN);
                  }
                  checked.value[index] = { ...box, textAlign: DEFAULT_TEXT_ALIGN };
                  // In case this component is itself the parent of children
                  // that were already placed on canvas before it was.
                  reclampChildren(index);
                } else {
                  delete checked.value[index];
                  if (selected.has(index)) {
                    const next = new Set(selected);
                    next.delete(index);
                    selected = next;
                  }
                }
              }}
            />
            <label
              for="comp-{index}"
              class="cursor-pointer truncate"
              title={component.label}
            >
              {#if !component.leaf}
                <span class="text-base-content/60 mr-1">▸</span>
              {/if}
              {component.label}
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    <br />
    <h3
      class="font-semibold text-sm mb-3 text-base-content/70 uppercase tracking-wide"
    >
      Connections
    </h3>

    <ul class="space-y-1">
      {#each connections as connection}
        <li class="flex items-center gap-2 text-sm">
          {connection.label}
        </li>
      {/each}
    </ul>
  </aside>
</div>
