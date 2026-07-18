<script lang="ts">
import {
  clamp_zoom,
  create_editor_state,
  reset_view,
} from "../../ViewEditorState.svelte";
import { isModifierHeld, isSpaceHeld } from "../../KeyboardState.svelte";
import { compile_system } from "../../rhizz_wasm_wrapper";
import persisted from "../../Persisted.svelte";
import type { ComponentJS } from "rhizz";
import {
  MIN_NODE_SIZE,
  boxBoundaryPoint,
  boxCenter,
  boxContains,
  clampResizeWithin,
  clampWithin,
  depthOf,
  elbowPath,
  textPosition,
  unionBox,
  type Box,
  type ConnectionOrientation,
  type TextAlign,
} from "./geometry";

const editor_state = create_editor_state();
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
let systems = $derived(model ? model.systems() : []);
let components = $derived(model ? model.components() : []);
let connections = $derived(model ? model.connections() : []);

// Builds a structurally-stable persistence key for a component: the path
// of labels from its root system down to it, e.g.
// "home-monitor/controller/mcu". Unlike the component's arena index (its
// position in model.components(), which shifts whenever components are
// reordered or inserted earlier in the HCL source), this key only changes
// if the component itself (or an ancestor) is renamed or reparented — a
// much rarer, more intentional edit. System labels are globally unique
// (unlike component labels, which are only unique within their parent
// scope — SPEC.md §2.3), so prefixing with the root system's label keeps
// the whole path collision-free even across multiple systems.
//
// Falls back to a `#<index>`-prefixed key (which can never collide with a
// real path, since real paths always contain at least one "/") if the
// chain can't be resolved — shouldn't happen for a resolved model, but
// keeps this total rather than throwing.
function componentKey(index: number): string {
  const parts: string[] = [];
  let current: number | undefined = index;
  while (current !== undefined) {
    const component: ComponentJS | undefined = components[current];
    if (!component) return `#${index}`;
    parts.unshift(component.label);
    if (component.parent_component_index !== undefined) {
      current = component.parent_component_index;
      continue;
    }
    const system =
      component.parent_system_index !== undefined
        ? systems[component.parent_system_index]
        : undefined;
    if (system) parts.unshift(system.label);
    current = undefined;
  }
  return parts.join("/");
}

// Reverse lookup from a persistence key back to the component's current
// arena index, rebuilt whenever `components`/`systems` change. Entries in
// `checked`/`savedLayout` whose key isn't found here belong to a component
// that no longer exists (renamed, removed, or reparented) and are simply
// not rendered.
let keyToIndex = $derived.by(() => {
  const map = new Map<string, number>();
  components.forEach((_, index) => map.set(componentKey(index), index));
  return map;
});

// Default node size, in world (SVG) units, for newly-placed nodes and for
// backfilling entries persisted before per-node sizing existed.
const DEFAULT_NODE_WIDTH = 100;
const DEFAULT_NODE_HEIGHT = 100;

// How many world units position/size snap to when "snap to grid" (below)
// is enabled. Kept as its own constant, separate from MINOR_GRID_SPACING,
// so it can be tuned independently — e.g. exposed as a UI-selectable
// multiplier later.
const SNAP_GRID_SIZE = 10;

// Whether the background grid is drawn. Toggled via the "Toggle Grid"
// button; not persisted — it's a transient display preference, not part
// of the saved diagram. Purely visual: the underlying rect stays in place
// either way, since it's also the hit-target for panning/marquee-select on
// empty canvas (see the <rect> using this below).
let gridVisible = $state(true);

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

// Default text alignment for newly-placed nodes and for backfilling
// entries persisted before per-node text alignment existed.
const DEFAULT_TEXT_ALIGN: TextAlign = "center";

// Position + size + style of a node, as stored in checked/savedLayout
// below. width/height/textAlign are optional so entries persisted before
// those features existed still parse; see nodeBox() for the backfilled
// read path.
type StoredBox = {
  x: number;
  y: number;
  width?: number;
  height?: number;
  textAlign?: TextAlign;
};

// Which components are currently placed on the canvas, keyed by
// componentKey() (a structurally-stable path of labels — see above), not
// by arena index: component labels are only unique within a parent scope
// (SPEC.md §2.3), so a bare label can't be used as a key once components
// are nested, but arena indices shift whenever components are reordered
// or inserted earlier in the HCL source, silently reattaching persisted
// positions to the wrong component (see TASKS.md Task 39). If a component
// is unchecked, it's not present here — but its last-known box is kept in
// savedLayout below, so re-checking it later restores it to where it was
// instead of resetting to the default position. Persisted so the diagram
// layout survives page reloads.
let checked = persisted<Record<string, StoredBox>>("DIAGRAM_CHECKED_NODES", {});

// Remembers every component's last-known box, even after it's unchecked
// (removed from `checked`) — entries here are never deleted, only updated.
// Read from when re-checking a component (see the sidebar checkbox
// handler) so a component's layout survives being temporarily removed
// from the canvas. Persisted separately from `checked` since the two have
// different lifetimes (checked entries disappear on uncheck; these don't).
let savedLayout = persisted<Record<string, StoredBox>>(
  "DIAGRAM_SAVED_LAYOUT",
  {},
);

// One-time migration away from the old arena-index-keyed scheme: those
// keys were plain integers (e.g. "0", "1"), which can never occur as a
// componentKey() path (a real path always contains at least one "/", from
// its root system label). There's no reliable way to migrate their values
// forward — the whole point of this change is that the old index→component
// mapping could silently be wrong — so this just strips them out rather
// than let them linger unused in localStorage forever; anyone with
// pre-existing diagram layouts gets a one-time reset.
function stripLegacyIndexKeys<T>(record: Record<string, T>): Record<string, T> {
  const withoutLegacyKeys = Object.fromEntries(
    Object.entries(record).filter(([key]) => !/^\d+$/.test(key)),
  );
  return Object.keys(withoutLegacyKeys).length === Object.keys(record).length
    ? record
    : withoutLegacyKeys;
}
checked.value = stripLegacyIndexKeys(checked.value);
savedLayout.value = stripLegacyIndexKeys(savedLayout.value);

// Writes `box` to both `checked` (the current on-canvas state) and
// savedLayout (the remembered layout), merging over any existing fields.
// Centralizing this in one place means every write site automatically
// keeps the remembered layout up to date, instead of relying on each call
// site to remember to mirror the write itself.
function setNodeBox(index: number, box: Partial<StoredBox>) {
  const key = componentKey(index);
  checked.value[key] = { ...checked.value[key], ...box };
  savedLayout.value[key] = { ...savedLayout.value[key], ...box };
}

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
  const pos = checked.value[componentKey(index)];
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
  if (!checked.value[componentKey(primarySelected)]) return;
  setNodeBox(primarySelected, { textAlign: align });
}

// Padding kept between a child node's edges and its active parent's edges,
// in world units.
const CHILD_CONTAINMENT_MARGIN = 10;

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
    setNodeBox(childIndex, clamped);
  });
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

// All pointer-driven canvas interactions (drag, resize, pan, marquee
// select) are mutually exclusive, so they're modeled as a single
// discriminated union rather than four independently-nullable state
// variables. This mirrors the interaction state machine used elsewhere in
// the app (see the removed EditorState union that used to live in
// ViewEditorState.svelte) and avoids having to reason about impossible
// combinations (e.g. dragging AND panning at once).
type Interaction =
  | { type: "idle" }
  | {
      // Dragging any selected node moves the whole selection together:
      // startPositions snapshots every selected node's position when the
      // drag begins; each move event recomputes every node's position
      // from its own snapshot plus the same delta the anchor (grabbed)
      // node moved by, so the group moves rigidly with no incremental
      // drift.
      type: "dragging";
      anchorIndex: number;
      offsetX: number;
      offsetY: number;
      startPositions: Record<number, { x: number; y: number }>;
    }
  | {
      // Resizing any selected node's handle scales the whole selection
      // together, proportionally, around the fixed top-left corner of the
      // selection's combined bounding box (groupBox, captured at resize
      // start alongside every selected node's starting box).
      type: "resizing";
      anchorIndex: number;
      groupBox: Box;
      startBoxes: Record<number, Box>;
    }
  | {
      // Canvas pan. Started by the middle mouse button, or the left
      // button while Space is held, anywhere on the canvas (including
      // over a node). lastX/lastY track screen-space pointer position of
      // the last move event.
      type: "panning";
      lastX: number;
      lastY: number;
    }
  | {
      // Marquee select: start point + current point, in world (SVG)
      // coordinates. Started by dragging the left mouse button over empty
      // canvas.
      type: "marquee";
      startX: number;
      startY: number;
      x: number;
      y: number;
    };

let interaction: Interaction = $state({ type: "idle" });

let marqueeBox: Box | null = $derived.by(() => {
  const current = interaction;
  if (current.type !== "marquee") return null;
  return {
    x: Math.min(current.startX, current.x),
    y: Math.min(current.startY, current.y),
    width: Math.abs(current.x - current.startX),
    height: Math.abs(current.y - current.startY),
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

// Middle mouse button, or the left button while Space is held, always
// pans, regardless of what's under the cursor — including directly over a
// node, so it must be handled here too (not just in onCanvasMouseDown,
// which only sees clicks on empty canvas).
function onNodeMouseDown(event: MouseEvent, index: number) {
  if (event.button === 1 || (event.button === 0 && isSpaceHeld())) {
    event.preventDefault();
    interaction = { type: "panning", lastX: event.clientX, lastY: event.clientY };
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
    const box = checked.value[componentKey(i)];
    if (box) startPositions[i] = { x: box.x, y: box.y };
  }
  const anchorStart = startPositions[index] ?? { x: 0, y: 0 };
  interaction = {
    type: "dragging",
    anchorIndex: index,
    offsetX: svgCoords.x - anchorStart.x,
    offsetY: svgCoords.y - anchorStart.y,
    startPositions,
  };
}

function onCanvasMouseDown(event: MouseEvent) {
  if (event.button === 1 || (event.button === 0 && isSpaceHeld())) {
    event.preventDefault();
    interaction = { type: "panning", lastX: event.clientX, lastY: event.clientY };
    return;
  }
  if (event.button !== 0) return;

  // Left-drag on empty canvas starts a marquee selection; the actual
  // selection change happens on mouseup, once the drag's extent is known
  // (see onSvgMouseUp).
  const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
  interaction = {
    type: "marquee",
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
  // Let a space-held click bubble up to the node's own mousedown handler,
  // which starts panning instead of a resize — keeps "how to start a pan"
  // in one place.
  if (isSpaceHeld()) return;
  event.preventDefault();
  event.stopPropagation();

  const startBoxes: Record<number, Box> = {};
  for (const i of selected) {
    const box = nodeBox(i);
    if (box) startBoxes[i] = box;
  }
  const groupBox = unionBox(Object.values(startBoxes));
  interaction = { type: "resizing", anchorIndex: index, groupBox, startBoxes };
}

function onSvgMouseMove(event: MouseEvent) {
  // Captured to a local const so TypeScript can narrow `current.type` per
  // switch case below — narrowing directly on the live `interaction`
  // $state binding doesn't work reliably across these branches.
  const current = interaction;
  switch (current.type) {
    case "dragging": {
      const anchorStart = current.startPositions[current.anchorIndex];
      const anchorBox = nodeBox(current.anchorIndex);
      if (anchorStart && anchorBox) {
        const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
        let anchorNext: Box = {
          x: snap(svgCoords.x - current.offsetX),
          y: snap(svgCoords.y - current.offsetY),
          width: anchorBox.width,
          height: anchorBox.height,
        };
        const anchorParentBox = activeParentBox(current.anchorIndex);
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

        for (const [indexStr, start] of Object.entries(current.startPositions)) {
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
          setNodeBox(index, next);
          reclampChildren(index);
        }
      }
      return;
    }
    case "resizing": {
      const anchorStart = current.startBoxes[current.anchorIndex];
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

        for (const [indexStr, startBox] of Object.entries(current.startBoxes)) {
          const index = Number(indexStr);
          const relX = startBox.x - current.groupBox.x;
          const relY = startBox.y - current.groupBox.y;
          const next = {
            x: snap(current.groupBox.x + relX * scaleX),
            y: snap(current.groupBox.y + relY * scaleY),
            width: snap(Math.max(MIN_NODE_SIZE, startBox.width * scaleX)),
            height: snap(Math.max(MIN_NODE_SIZE, startBox.height * scaleY)),
          };
          setNodeBox(index, next);
        }
      }
      return;
    }
    case "panning": {
      const dxScreen = event.clientX - current.lastX;
      const dyScreen = event.clientY - current.lastY;
      const zoom = editor_state.view.zoom;
      editor_state.view.x -= dxScreen / zoom;
      editor_state.view.y -= dyScreen / zoom;
      interaction = { type: "panning", lastX: event.clientX, lastY: event.clientY };
      return;
    }
    case "marquee": {
      const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
      interaction = { ...current, x: svgCoords.x, y: svgCoords.y };
      return;
    }
    case "idle":
      return;
  }
}

function onSvgMouseUp() {
  const current = interaction;
  if (current.type === "marquee") {
    // A marquee with negligible size is just a click: clear the selection
    // (matches the old "click empty canvas to deselect" behavior).
    // Otherwise, commit whatever the live preview (marqueeCandidates) was
    // already showing.
    const box = marqueeBox;
    selected = box && (box.width > 2 || box.height > 2)
      ? new Set(marqueeCandidates)
      : new Set();
  }
  interaction = { type: "idle" };
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

// Looks up a component's direct parent index, for depthOf below.
function parentOf(index: number): number | undefined {
  return components[index]?.parent_component_index;
}

// Indices of currently-placed nodes, ordered shallowest-first so parents
// are always painted before their children — otherwise a child could end
// up visually hidden behind its parent's fill, depending on arbitrary
// arena order.
let renderOrder = $derived(
  Object.keys(checked.value)
    .map((key) => keyToIndex.get(key))
    .filter((index): index is number => index !== undefined)
    .sort((a, b) => depthOf(a, parentOf) - depthOf(b, parentOf)),
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

// Fraction of the viewport the diagram's bounding box should fill (in
// whichever axis is more constraining, so it fits fully in both) when
// "Zoom to Fill" is used.
const ZOOM_TO_FILL_FRACTION = 0.8;

// Zooms and pans so every currently-placed node's combined bounding box
// fills ZOOM_TO_FILL_FRACTION of the viewport, centered. No-op if nothing
// is placed on canvas.
function zoomToFill() {
  const boxes = renderOrder
    .map((index) => nodeBox(index))
    .filter(
      (box): box is NonNullable<ReturnType<typeof nodeBox>> => box !== null,
    );
  if (boxes.length === 0) return;
  const bounds = unionBox(boxes);

  const zoomX = (canvas_width * ZOOM_TO_FILL_FRACTION) / bounds.width;
  const zoomY = (canvas_height * ZOOM_TO_FILL_FRACTION) / bounds.height;
  const newZoom = clamp_zoom(Math.min(zoomX, zoomY));

  editor_state.view.zoom = newZoom;
  editor_state.view.x = bounds.x + bounds.width / 2 -
    canvas_width / newZoom / 2;
  editor_state.view.y = bounds.y + bounds.height / 2 -
    canvas_height / newZoom / 2;
}
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
      class="relative flex-1 w-full h-full bg-base-300"
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
        style="cursor: {interaction.type === 'dragging' ||
        interaction.type === 'resizing' ||
        interaction.type === 'panning'
          ? 'grabbing'
          : interaction.type === 'marquee'
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
                stroke="var(--color-base-content)"
                stroke-opacity="0.08"
                stroke-width="1"
              />
              <line
                x1="0"
                y1={i}
                x2={MAJOR_GRID_SPACING}
                y2={i}
                stroke="var(--color-base-content)"
                stroke-opacity="0.08"
                stroke-width="1"
              />
            {/each}
            <line
              x1="0"
              y1="0"
              x2={MAJOR_GRID_SPACING}
              y2="0"
              stroke="var(--color-base-content)"
              stroke-opacity="0.2"
              stroke-width="1"
            />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={MAJOR_GRID_SPACING}
              stroke="var(--color-base-content)"
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
              fill="var(--color-base-content)"
              fill-opacity="0.5"
            />
          </marker>
        </defs>
        <rect
          fill={gridVisible ? "url(#Grid)" : "transparent"}
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
          {@const highlighted = interaction.type === "marquee"
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
              stroke={highlighted
                ? "var(--color-primary)"
                : "var(--color-base-content)"}
              stroke-width={highlighted ? 2 : 1}
              fill="var(--color-base-200)"
            />
            <text
              x={textPos.x}
              y={textPos.y}
              fill="var(--color-base-content)"
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
            stroke="var(--color-base-content)"
            stroke-opacity="0.35"
            stroke-width="1.5"
            fill="none"
            marker-end="url(#arrow)"
            style="pointer-events: none"
          />
          <text
            x={(a.x + b.x) / 2}
            y={(a.y + b.y) / 2 - 6}
            fill="var(--color-base-content)"
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
          onclick={() => (gridVisible = !gridVisible)}
          class="btn btn-sm {gridVisible ? 'btn-ghost' : 'btn-primary'}"
          title="Toggle background grid visibility - nice for screenshots"
        >
          Toggle Grid
        </button>
        <button
          onclick={zoomToFill}
          class="btn btn-ghost btn-sm"
          title="Zoom and pan to fit the whole diagram - useful for screenshots"
        >
          Zoom to Fill
        </button>
        <button
          onclick={() => reset_view(editor_state)}
          class="btn btn-ghost btn-sm"
          title="Reset pan and zoom. Useful when you get lost in the diagram"
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
              checked={!!checked.value[componentKey(index)]}
              onchange={(value) => {
                if (value.currentTarget.checked) {
                  // Restore the remembered layout if this component has
                  // been placed before (even if it was later unchecked),
                  // instead of always resetting to the default position.
                  const remembered = savedLayout.value[componentKey(index)];
                  let box: Box = {
                    x: remembered?.x ?? 100,
                    y: remembered?.y ?? 100,
                    width: remembered?.width ?? DEFAULT_NODE_WIDTH,
                    height: remembered?.height ?? DEFAULT_NODE_HEIGHT,
                  };
                  const parentBox = activeParentBox(index);
                  if (parentBox) {
                    box = clampWithin(box, parentBox, CHILD_CONTAINMENT_MARGIN);
                  }
                  setNodeBox(index, {
                    ...box,
                    textAlign: remembered?.textAlign ?? DEFAULT_TEXT_ALIGN,
                  });
                  // In case this component is itself the parent of children
                  // that were already placed on canvas before it was.
                  reclampChildren(index);
                } else {
                  delete checked.value[componentKey(index)];
                  // savedLayout.value[componentKey(index)] is intentionally
                  // left alone, so re-checking this component later
                  // restores it here.
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
