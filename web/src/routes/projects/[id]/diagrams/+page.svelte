<script lang="ts">
import { resolve } from "$app/paths";
import {
  clamp_zoom,
  create_editor_state,
  reset_view,
} from "../../../../ViewEditorState.svelte";
import { isModifierHeld, isSpaceHeld } from "../../../../KeyboardState.svelte";
import { SvelteSet } from "svelte/reactivity";
import { compile_system } from "../../../../rhizz_wasm_wrapper";
import persisted from "../../../../Persisted.svelte";
import {
  projectStore,
  setCurrentDiagnostics,
  setCurrentScore,
} from "../../../../ProjectState.svelte";
import { readProjectSources, type Source } from "../../../../vfs/compile";
import { type Dirent, openProjectFs } from "../../../../vfs/fs";
import type { ComponentJS } from "rhizz";
import type { PageProps } from "./$types";
import FileTree from "../editor/FileTree.svelte";
import DiagramToolbar from "./DiagramToolbar.svelte";
import NodeInspector from "./NodeInspector.svelte";
import CreateComponentModal from "./CreateComponentModal.svelte";
import {
  type ComponentData,
  DocumentStore,
  type PortData,
} from "../../../../DocumentStore.svelte";

import {
  DIAGRAM_LAYOUT_DIR,
  emptyDiagramLayout,
  readDiagramLayoutFile,
  type StoredBox,
  writeDiagramLayoutFile,
} from "./persistence";
import {
  createHistoryStack,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./history";
import {
  createForceLayout,
  groupBySiblings,
  type LayoutEdge,
  type LayoutNode,
} from "./forceLayout";
import {
  type Box,
  boxBoundaryPoint,
  boxCenter,
  boxContains,
  clampWithin,
  computePortPositions,
  type ConnectionOrientation,
  depthOf,
  elbowPath,
  findConnectTarget,
  findReparentTarget,
  MIN_NODE_SIZE,
  type TextAlign,
  textPosition,
  unionBox,
} from "./geometry";

const editor_state = create_editor_state("DIAGRAM_VIEW");
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

let { data }: PageProps = $props();

let fs = $derived(openProjectFs(projectStore, data.projectId));

let sources = $state<Source[]>([]);
$effect(() => {
  readProjectSources(fs).then((s) => {
    sources = s;
  });
});

let output = $derived.by(() => compile_system(sources));
let model = $derived(output.model());
let systems = $derived(model ? model.systems() : []);
let components = $derived(model ? model.components() : []);
let connections = $derived(model ? model.connections() : []);

let compileErrors = $derived.by(() => {
  return output.diagnostics().filter((d) => d.level === "Error");
});
let firstError = $derived(compileErrors[0] ?? null);

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
    const system = component.parent_system_index !== undefined
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
  // Built fresh and returned as-is on every recomputation; reactivity
  // already comes from the surrounding $derived.by, not from mutating
  // this Map later.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const map = new Map<string, number>();
  components.forEach((_, index) => map.set(componentKey(index), index));
  return map;
});

// Default node size, in world (SVG) units, for newly-placed nodes and for
// backfilling entries persisted before per-node sizing existed.
const DEFAULT_NODE_WIDTH = 100;
const DEFAULT_NODE_HEIGHT = 100;

// User-selectable snap grid sizes, in world units, offered by the
// dropdown next to the "Snap to Grid" button. A fixed set (rather than a
// free-form numeric input) keeps the choices "nice" round numbers that
// also line up with MINOR_GRID_SPACING/MAJOR_GRID_SPACING above.
const SNAP_GRID_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_SNAP_GRID_SIZE: number = SNAP_GRID_SIZE_OPTIONS[0];

// How many world units position/size snap to when "snap to grid" (below)
// is enabled. Separate from MINOR_GRID_SPACING so it can be tuned
// independently. Persisted (unlike gridVisible/snapEnabled below) since
// it's more of a per-project preference than a transient editing mode —
// adjustable via the dropdown next to the "Snap to Grid" button.
let snapGridSize = persisted("DIAGRAM_SNAP_GRID_SIZE", DEFAULT_SNAP_GRID_SIZE);

// Whether the background grid is drawn. Toggled via the "Toggle Grid"
// button; not persisted — it's a transient display preference, not part
// of the saved diagram. Purely visual: the underlying rect stays in place
// either way, since it's also the hit-target for panning/marquee-select on
// empty canvas (see the <rect> using this below).
let gridVisible = $state(true);

// Whether dragging/resizing snaps position/size to snapGridSize-unit
// increments. Toggled via the "Snap to Grid" button; not persisted — it's
// a transient editing mode, not part of the saved diagram.
// (snapGridSize itself, above, is persisted.)
let snapEnabled = $state(false);

// Whether snapping is actually in effect right now: either the toggle is
// on, or the modifier key (Ctrl/Cmd) is currently held as a quick
// temporary override. A $derived (rather than inlining the check into
// snap()) so the "Snap to Grid" button can also reflect the live
// modifier-key override, not just the persistent toggle.
let snapActive = $derived(snapEnabled || isModifierHeld());

// Rounds `value` to the nearest multiple of snapGridSize, or returns it
// unchanged when snapping is off. Falls back to the default grid size
// rather than trusting the persisted value is still a valid, positive
// option (e.g. if localStorage is hand-edited to 0 or a negative number).
function snap(value: number): number {
  if (!snapActive) return value;
  const gridSize = snapGridSize.value > 0
    ? snapGridSize.value
    : DEFAULT_SNAP_GRID_SIZE;
  return Math.round(value / gridSize) * gridSize;
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

// Which components are currently placed on the canvas, keyed by
// componentKey() (a structurally-stable path of labels — see above), not
// by arena index: component labels are only unique within a parent scope
// (SPEC.md §2.3), so a bare label can't be used as a key once components
// are nested, but arena indices shift whenever components are reordered
// or inserted earlier in the HCL source, silently reattaching persisted
// positions to the wrong component (see TASKS.md Task 39). If a component
// is unchecked, it's not present here — but its last-known box is kept in
// savedLayout below, so re-checking it later restores it to where it was
// instead of resetting to the default position. Persisted into the active
// project's VFS (see the load/save $effects below), so the diagram layout
// travels with the project instead of being shared across every project
// in the browser (TASKS.md Task 60).
let checked = $state<Record<string, StoredBox>>({});

// Remembers every component's last-known box, even after it's unchecked
// (removed from `checked`) — entries here are never deleted, only updated.
// Read from when re-checking a component (see the sidebar checkbox
// handler) so a component's layout survives being temporarily removed
// from the canvas. Persisted separately from `checked` since the two have
// different lifetimes (checked entries disappear on uncheck; these don't).
let savedLayout = $state<Record<string, StoredBox>>({});

// Which diagram (a `.rhizz/diagrams/<name>.json` file) is currently open
// on the canvas, relative to DIAGRAM_LAYOUT_DIR — e.g. "main.json" —
// exactly like the editor's own `selectedPath` is relative to the
// project root (TASKS.md Task 66). `null` means no diagram exists yet
// (or none is selected), in which case the canvas below simply has
// nothing placed on it.
let selectedDiagramPath = $state<string | null>(null);
let diagramEntries = $state<Dirent[]>([]);

let fullDiagramPath = $derived(
  selectedDiagramPath === null
    ? null
    : `${DIAGRAM_LAYOUT_DIR}/${selectedDiagramPath}`,
);

async function refreshDiagramEntries(): Promise<void> {
  try {
    diagramEntries = await fs.readdir(DIAGRAM_LAYOUT_DIR, {
      recursive: true,
    });
  } catch {
    // No diagram has ever been saved for this project yet, so
    // DIAGRAM_LAYOUT_DIR itself doesn't exist (ENOENT) — there's simply
    // nothing to list.
    diagramEntries = [];
  }
}

// Picks a sensible default diagram to open: the first ".hcl" (or legacy ".json") file found
// (in practice "main.hcl" — see the auto-seed below), or `null` if the
// project has no diagrams at all yet.
function firstDiagramPath(): string | null {
  return (
    diagramEntries.find(
      (e) =>
        e.isFile() && (e.name.endsWith(".hcl") || e.name.endsWith(".json")),
    )?.path ?? null
  );
}

// (Re)loads the diagram file list once per project, when the project
// first becomes available or changes identity (e.g. after switching
// projects).
let loadedDiagramProjectId: string | null = null;
$effect(() => {
  const id = data.projectId;
  if (id === loadedDiagramProjectId) return;
  loadedDiagramProjectId = id;
  selectedDiagramPath = null;
  refreshDiagramEntries()
    .then(async () => {
      if (firstDiagramPath() === null) {
        // A brand new project has no diagram files yet — seed one so
        // there's always something selected/editable, mirroring how a
        // fresh project always starts with a "main.hcl" (see
        // ProjectState.svelte's createProjectWithMainFile) rather than an
        // empty file list. Without this, checking a component onto the
        // canvas before ever creating a diagram would silently never be
        // persisted (fullDiagramPath stays null).
        await writeDiagramLayoutFile(
          fs,
          `${DIAGRAM_LAYOUT_DIR}/main.hcl`,
          emptyDiagramLayout(),
        );
        await refreshDiagramEntries();
      }
      selectedDiagramPath = firstDiagramPath();
    })
    .catch((err) => {
      console.error("Failed to initialize diagram entries:", err);
    });
});

// Guards the write-back $effect below against firing with stale/empty
// data while the load for the *currently selected diagram* is still in
// flight — reset to false whenever fullDiagramPath changes, flipped back
// to true once that file has loaded. Without this, switching from one
// diagram (or project) to another would briefly overwrite the
// newly-selected file with the previous selection's (or an empty)
// layout.
let diagramLayoutLoaded = $state(false);
let loadedDiagramPath: string | null = null;

$effect(() => {
  const path = fullDiagramPath;
  if (path === loadedDiagramPath) return;
  loadedDiagramPath = path;
  diagramLayoutLoaded = false;

  if (path === null) {
    checked = {};
    savedLayout = {};
    return;
  }

  readDiagramLayoutFile(fs, path).then((layout) => {
    // A stale load (e.g. rapid switching between diagrams) could resolve
    // after a newer one already changed the selection — guard against
    // overwriting the newer selection's state with the older one.
    if (loadedDiagramPath !== path) return;
    checked = layout.checked;
    savedLayout = layout.savedLayout;
    diagramLayoutLoaded = true;
    // Frames the newly-opened diagram's content immediately, rather than
    // leaving the view wherever the previously-open diagram (or the
    // default pan/zoom) happened to leave it — renderOrder/nodeBox()
    // already reflect the `checked` assignment above by the time this
    // runs, since they're plain $derived reads, not effects.
    zoomToFill();
  });
});

$effect(() => {
  // $state.snapshot() deeply reads (and detaches from reactivity) every
  // property of `checked`/`savedLayout` synchronously, right here in the
  // effect body — which is what makes later in-place mutations like
  // `checked[key] = {...}` cause this effect to re-run at all.
  // writeDiagramLayoutFile() is async, so if it (or JSON.stringify) were
  // the thing reading those properties, that read would happen after an
  // `await`, i.e. outside the synchronous window Svelte uses to record an
  // effect's dependencies — leaving this effect subscribed only to
  // `checked`/`savedLayout`'s own top-level references, never to writes
  // into them.
  const snapshot = {
    checked: $state.snapshot(checked),
    savedLayout: $state.snapshot(savedLayout),
  };
  const path = fullDiagramPath;
  if (!diagramLayoutLoaded || path === null) return;
  writeDiagramLayoutFile(fs, path, snapshot);
});

function reportDiagramError(error: unknown): void {
  alert(error instanceof Error ? error.message : String(error));
}

// Strips leading/trailing slashes and rejects anything containing "/" or
// only whitespace — prompt() collects a bare name (a new path segment),
// never a nested path, matching the editor's own FileTree wiring.
function sanitizeDiagramSegmentName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.includes("/")) return null;
  return trimmed;
}

function joinDiagramPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

async function handleCreateDiagram(parentPath: string): Promise<void> {
  const name = sanitizeDiagramSegmentName(
    prompt("New diagram name?", "Untitled.hcl") ?? "",
  );
  if (name === null) return;
  const path = joinDiagramPath(parentPath, name);
  try {
    await writeDiagramLayoutFile(
      fs,
      `${DIAGRAM_LAYOUT_DIR}/${path}`,
      emptyDiagramLayout(),
    );
    await refreshDiagramEntries();
    selectedDiagramPath = path;
  } catch (error) {
    reportDiagramError(error);
  }
}

async function handleCreateDiagramFolder(parentPath: string): Promise<void> {
  const name = sanitizeDiagramSegmentName(
    prompt("New folder name?", "untitled") ?? "",
  );
  if (name === null) return;
  try {
    await fs.mkdir(
      `${DIAGRAM_LAYOUT_DIR}/${joinDiagramPath(parentPath, name)}`,
      { recursive: true },
    );
    await refreshDiagramEntries();
  } catch (error) {
    reportDiagramError(error);
  }
}

async function handleRenameDiagram(path: string): Promise<void> {
  const segments = path.split("/");
  const oldName = segments[segments.length - 1];
  const parentPath = segments.slice(0, -1).join("/");
  const name = sanitizeDiagramSegmentName(prompt("Rename to?", oldName) ?? "");
  if (name === null || name === oldName) return;
  const newPath = joinDiagramPath(parentPath, name);
  try {
    await fs.rename(
      `${DIAGRAM_LAYOUT_DIR}/${path}`,
      `${DIAGRAM_LAYOUT_DIR}/${newPath}`,
    );
    if (selectedDiagramPath === path) selectedDiagramPath = newPath;
    await refreshDiagramEntries();
  } catch (error) {
    reportDiagramError(error);
  }
}

async function handleDeleteDiagram(path: string): Promise<void> {
  if (!confirm(`Delete "${path}"? This can't be undone.`)) return;
  try {
    await fs.rm(`${DIAGRAM_LAYOUT_DIR}/${path}`, { recursive: true });
    if (
      selectedDiagramPath === path ||
      selectedDiagramPath?.startsWith(`${path}/`)
    ) {
      selectedDiagramPath = null;
    }
    await refreshDiagramEntries();
    if (selectedDiagramPath === null) selectedDiagramPath = firstDiagramPath();
  } catch (error) {
    reportDiagramError(error);
  }
}

// Writes `box` to both `checked` (the current on-canvas state) and
// savedLayout (the remembered layout), merging over any existing fields.
// Centralizing this in one place means every write site automatically
// keeps the remembered layout up to date, instead of relying on each call
// site to remember to mirror the write itself.
function setNodeBox(index: number, box: Partial<StoredBox>) {
  const key = componentKey(index);
  checked[key] = { ...checked[key], ...box };
  savedLayout[key] = { ...savedLayout[key], ...box };
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
  const pos = checked[componentKey(index)];
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
  const box = checked[componentKey(primarySelected)];
  if (!box) return;
  if (box.textAlign === align) return; // no-op: skip a redundant undo point
  recordUndoPoint();
  setNodeBox(primarySelected, { textAlign: align });
}

// Padding kept between a child node's edges and its active parent's edges,
// in world units.
const CHILD_CONTAINMENT_MARGIN = 10;

// Extra padding reserved at a parent's *top* edge specifically, on top of
// CHILD_CONTAINMENT_MARGIN, so a child can never be dragged/laid out over
// the area where the parent's own title text is rendered (see
// textPosition() in geometry.ts — the label sits near the top of the box
// for the "top-center"/"top-left" alignments, and even for "center" a
// child overlapping the exact middle would still obscure it). Sized to
// comfortably clear a label line plus its own padding.
const CHILD_CONTAINMENT_TOP_MARGIN = 28;

// Returns the box of `index`'s parent component, but only if that parent is
// itself currently placed on the canvas ("active") — a node with a parent
// that isn't on canvas has nothing to be constrained by. Only considers the
// direct parent — a node only ever needs to stay within its own immediate
// parent's box; staying within *its* parent's ancestors transitively is
// handled separately by reclampChildren's recursive cascade below, once a
// middle ancestor's own box changes.
function activeParentBox(index: number): ReturnType<typeof nodeBox> | null {
  const parentIndex = components[index]?.parent_component_index;
  if (parentIndex === undefined) return null;
  return nodeBox(parentIndex);
}

// Re-clamps every currently-placed direct child of `parentIndex` against
// the parent's current box, then recurses into each clamped child so
// grandchildren (and deeper) are re-clamped against their own
// just-updated parent in turn — cascading containment through the whole
// ancestor chain, not just one level. Called after a parent is dragged or
// resized so its descendants' constraint regions follow it live, and
// after checking a new component (in case it's a parent of already-placed
// children). Naturally bounded by what's actually on-screen, since a
// component that isn't currently placed has no box to clamp or recurse
// into.
function reclampChildren(parentIndex: number) {
  const parentBox = nodeBox(parentIndex);
  if (!parentBox) return;
  components.forEach((component, childIndex) => {
    if (component.parent_component_index !== parentIndex) return;
    const box = nodeBox(childIndex);
    if (!box) return; // not currently placed on canvas
    const clamped = clampWithin(
      box,
      parentBox,
      CHILD_CONTAINMENT_MARGIN,
      CHILD_CONTAINMENT_TOP_MARGIN,
    );
    setNodeBox(childIndex, clamped);
    reclampChildren(childIndex);
  });
}

// Currently selected nodes (component arena indices). Not persisted —
// selection is transient UI state. Uses SvelteSet (from svelte/reactivity)
// rather than a plain Set wrapped in $state, since plain Set mutations
// aren't deeply tracked by Svelte's $state the way plain object/array
// mutations are — SvelteSet makes add()/delete()/clear() directly
// reactive, so call sites can mutate it in place instead of always
// reconstructing and reassigning a fresh Set.
const selected = new SvelteSet<number>();

// Snapshot of the diagram's persisted content — the unit of undo/redo
// history. Deliberately excludes `selected` (transient UI state, not
// diagram content, and not guaranteed to still make sense after
// restoring an older/newer snapshot) and view/grid/snap preferences.
type DiagramSnapshot = {
  checked: Record<string, StoredBox>;
  savedLayout: Record<string, StoredBox>;
};

// How many undo steps (and, independently, redo steps) are kept.
const UNDO_HISTORY_LIMIT = 100;
const diagramHistory = createHistoryStack<DiagramSnapshot>();

function snapshotDiagram(): DiagramSnapshot {
  return {
    checked: { ...checked },
    savedLayout: { ...savedLayout },
  };
}

function applyDiagramSnapshot(snapshot: DiagramSnapshot) {
  // Copies (rather than reuses) the snapshot's records, so the object
  // sitting in the undo/redo stacks is never the same live object that
  // setNodeBox() et al. go on to mutate afterwards.
  checked = { ...snapshot.checked };
  savedLayout = { ...snapshot.savedLayout };
  // The restored snapshot may not have (or may no longer make sense for)
  // the same selection, so it's simplest and safest to just clear it.
  selected.clear();
}

// Records the diagram's current state as an undo point, right *before* a
// discrete edit is about to change it — a drag/resize gesture starting, a
// component being checked/unchecked, a text-alignment change, or an
// auto-layout run. Must be called once per *gesture*, not once per
// underlying setNodeBox() write: a whole drag, from mousedown to mouseup,
// is one undo step, not one per mousemove event (see call sites).
function recordUndoPoint() {
  pushHistory(diagramHistory, snapshotDiagram(), UNDO_HISTORY_LIMIT);
}

// Ctrl/Cmd+Z. Blocked while auto-layout is running, same as the other
// diagram-mutating interactions — restoring a snapshot while the
// animation loop is still writing every frame would just get immediately
// overwritten.
function undoDiagramEdit() {
  if (autoLayoutRunning) return;
  const previous = undoHistory(
    diagramHistory,
    snapshotDiagram(),
    UNDO_HISTORY_LIMIT,
  );
  if (previous) {
    applyDiagramSnapshot(previous);
    flashActivity("Undo");
  }
}

// Ctrl/Cmd+Y (or Ctrl/Cmd+Shift+Z, the Mac-idiomatic alternative).
function redoDiagramEdit() {
  if (autoLayoutRunning) return;
  const next = redoHistory(
    diagramHistory,
    snapshotDiagram(),
    UNDO_HISTORY_LIMIT,
  );
  if (next) {
    applyDiagramSnapshot(next);
    flashActivity("Redo");
  }
}

// Handles the undo/redo keyboard shortcuts. Scoped to this page (via the
// <svelte:window> binding below), rather than living in the app-wide
// KeyboardState.svelte module, since "undo" here specifically means
// "undo a diagram edit" — a different page (e.g. the HCL text editor)
// would want its own, unrelated undo behavior.
function onDiagramKeyDown(event: KeyboardEvent) {
  const primary = event.ctrlKey || event.metaKey;
  if (!primary) return;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undoDiagramEdit();
  } else if (key === "y" || (key === "z" && event.shiftKey)) {
    event.preventDefault();
    redoDiagramEdit();
  }
}

// The single selected node, or null if zero or more than one are selected.
// Used wherever an operation only makes sense for exactly one node (the
// inspector's details/text-alignment controls).
let primarySelected = $derived(
  selected.size === 1 ? [...selected][0] : null,
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
  }
  | {
    type: "connecting";
    sourceComponentIndex: number;
    sourcePortLabel: string | null;
    sourcePoint: { x: number; y: number };
    currentPoint: { x: number; y: number };
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

let reparentTargetIndex = $state<number | null>(null);

function isDescendantOf(index: number, possibleAncestor: number): boolean {
  let cur = parentOf(index);
  while (cur !== undefined) {
    if (cur === possibleAncestor) return true;
    cur = parentOf(cur);
  }
  return false;
}

async function getPrimaryHclPath(): Promise<string> {
  try {
    const entries = await fs.readdir(".", { recursive: true });
    const hclFiles = entries.filter((e) =>
      e.isFile() && e.name.endsWith(".hcl")
    );
    const preferred = hclFiles.find(
      (e) =>
        e.name === "main.hcl" ||
        e.name === "system.hcl" ||
        e.name === "systems.hcl",
    );
    return preferred?.path ?? hclFiles[0]?.path ?? "main.hcl";
  } catch {
    return "main.hcl";
  }
}

async function readMainContent(): Promise<{ path: string; content: string }> {
  const targetPath = await getPrimaryHclPath();
  try {
    const content = await fs.readFile(targetPath);
    return { path: targetPath, content };
  } catch {
    return {
      path: targetPath,
      content: sources.map((s) => s.content).join("\n"),
    };
  }
}

async function executeReparent(
  sourceKey: string,
  targetParentKey: string,
): Promise<void> {
  const { path: targetPath, content: mainContent } = await readMainContent();

  const doc = new DocumentStore();
  if (mainContent.trim()) {
    doc.loadFromHcl(mainContent);
  }

  if (doc.reparentComponent(sourceKey, targetParentKey)) {
    await fs.writeFile(targetPath, doc.systemHcl);
    sources = await readProjectSources(fs);
  }
}

async function handleAddSystem(): Promise<void> {
  const name = prompt("New system name?", `system-${systems.length + 1}`)
    ?.trim();
  if (!name) return;

  const { path: targetPath, content: mainContent } = await readMainContent();

  const doc = new DocumentStore();
  if (mainContent.trim()) {
    doc.loadFromHcl(mainContent);
  }
  doc.addSystem(name);
  await fs.writeFile(targetPath, doc.systemHcl);
  sources = await readProjectSources(fs);
}

let availableParents = $derived.by(() => {
  const options: {
    key: string;
    label: string;
    isSystem: boolean;
    path: string;
  }[] = [];

  for (const sys of systems) {
    options.push({
      key: sys.label,
      label: sys.label,
      isSystem: true,
      path: sys.label,
    });
  }

  components.forEach((comp, idx) => {
    const key = componentKey(idx);
    options.push({
      key,
      label: comp.label,
      isSystem: false,
      path: key,
    });
  });

  return options;
});

let isCreateModalOpen = $state(false);
let createModalPosition = $state<{ x: number; y: number } | undefined>(
  undefined,
);
let createModalDefaultParent = $state<string | undefined>(undefined);

function openCreateComponentModal(
  pos?: { x: number; y: number },
  parentKey?: string,
) {
  let targetParent = parentKey;
  if (!targetParent && selected.size === 1) {
    const selIdx = selected.values().next().value;
    if (selIdx !== undefined) {
      targetParent = componentKey(selIdx);
    }
  }
  if (!targetParent) {
    targetParent = systems[0]?.label || "main";
  }

  createModalPosition = pos;
  createModalDefaultParent = targetParent;
  isCreateModalOpen = true;
}

function onNodeDblClick(event: MouseEvent, index: number) {
  event.stopPropagation();
  event.preventDefault();
  const parentKey = componentKey(index);
  const coords = svgPoint(root_svg, event.clientX, event.clientY);
  openCreateComponentModal(
    {
      x: coords.x - DEFAULT_NODE_WIDTH / 2,
      y: coords.y - DEFAULT_NODE_HEIGHT / 2,
    },
    parentKey,
  );
}

async function handleModalCreateComponent(data: {
  label: string;
  parentKey: string;
  description: string;
  tags: string[];
  leaf: boolean;
  ports: PortData[];
  textAlign?: TextAlign;
  position?: { x: number; y: number };
}): Promise<void> {
  isCreateModalOpen = false;

  const { path: targetPath, content: mainContent } = await readMainContent();

  const doc = new DocumentStore();
  if (mainContent.trim()) {
    doc.loadFromHcl(mainContent);
  }

  let parent = data.parentKey;
  if (!parent || !doc.findContainer(parent)) {
    if (doc.systems.length === 0) {
      doc.addSystem(parent || "main");
      parent = parent || "main";
    } else {
      parent = doc.systems[0].label;
    }
  }

  const added = doc.addComponent(parent, data.label, data.leaf);
  if (added) {
    added.description = data.description;
    added.tags = data.tags;
    added.ports = data.ports;
  }

  await fs.writeFile(targetPath, doc.systemHcl);
  sources = await readProjectSources(fs);

  const fullKey = `${parent}/${data.label}`;
  const worldX = data.position ? snap(data.position.x) : 100;
  const worldY = data.position ? snap(data.position.y) : 100;

  checked[fullKey] = {
    x: worldX,
    y: worldY,
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
    textAlign: data.textAlign ?? DEFAULT_TEXT_ALIGN,
  };
  savedLayout[fullKey] = { ...checked[fullKey] };

  const newIndex = keyToIndex.get(fullKey);
  if (newIndex !== undefined) {
    selected.clear();
    selected.add(newIndex);
  }
}

function onCanvasDblClick(event: MouseEvent) {
  const target = event.target as HTMLElement | SVGElement;
  if (target === root_svg || target.tagName === "rect") {
    const coords = svgPoint(root_svg, event.clientX, event.clientY);
    openCreateComponentModal({
      x: coords.x - DEFAULT_NODE_WIDTH / 2,
      y: coords.y - DEFAULT_NODE_HEIGHT / 2,
    });
  }
}

let docStore = $derived.by(() => {
  const mainContent = sources.find((s) =>
    s.filename.endsWith("main.hcl")
  )?.content ||
    sources.map((s) => s.content).join("\n");
  const doc = new DocumentStore();
  if (mainContent.trim()) {
    doc.loadFromHcl(mainContent);
  }
  return doc;
});

$effect(() => {
  const sc = output.model()?.score();
  setCurrentScore(sc ? { overall_percentage: sc.overall_percentage } : null);
  setCurrentDiagnostics({
    errors: output.error_count(),
    warnings: output.warning_count(),
  });
  return () => {
    setCurrentScore(null);
    setCurrentDiagnostics(null);
  };
});

let selectedKey = $derived(
  selected.size === 1 ? componentKey(selected.values().next().value!) : null,
);

let selectedComponentData = $derived(
  selectedKey ? docStore.findComponent(selectedKey) : null,
);

async function handleUpdateSelectedComponent(
  patch: Partial<ComponentData>,
): Promise<void> {
  if (!selectedKey) return;
  const { path: targetPath, content: mainContent } = await readMainContent();
  const doc = new DocumentStore();
  if (mainContent.trim()) {
    doc.loadFromHcl(mainContent);
  }
  if (doc.updateComponent(selectedKey, patch)) {
    await fs.writeFile(targetPath, doc.systemHcl);
    sources = await readProjectSources(fs);
  }
}

async function handleRenameSelectedComponent(newLabel: string): Promise<void> {
  if (!selectedKey) return;
  const parts = selectedKey.split("/").filter(Boolean);
  const oldLabel = parts[parts.length - 1];
  if (newLabel === oldLabel) return;
  const parentPath = parts.slice(0, -1).join("/");
  const newKey = `${parentPath}/${newLabel}`;

  const { path: targetPath, content: mainContent } = await readMainContent();
  const doc = new DocumentStore();
  if (mainContent.trim()) {
    doc.loadFromHcl(mainContent);
  }

  const comp = doc.findComponent(selectedKey);
  if (comp) {
    comp.label = newLabel;
    await fs.writeFile(targetPath, doc.systemHcl);
    sources = await readProjectSources(fs);

    if (checked[selectedKey]) {
      checked[newKey] = checked[selectedKey];
      delete checked[selectedKey];
    }
    if (savedLayout[selectedKey]) {
      savedLayout[newKey] = savedLayout[selectedKey];
      delete savedLayout[selectedKey];
    }
  }
}

async function handleDeleteSelectedComponent(): Promise<void> {
  if (!selectedKey) return;
  const keyToDelete = selectedKey;
  const { path: targetPath, content: mainContent } = await readMainContent();
  const doc = new DocumentStore();
  if (mainContent.trim()) {
    doc.loadFromHcl(mainContent);
  }

  if (doc.deleteComponent(keyToDelete)) {
    await fs.writeFile(targetPath, doc.systemHcl);
    sources = await readProjectSources(fs);

    delete checked[keyToDelete];
    delete savedLayout[keyToDelete];
    selected.clear();
  }
}

function onPortMouseDown(
  event: MouseEvent,
  compIndex: number,
  portLabel: string | null,
  worldPoint: { x: number; y: number },
) {
  event.stopPropagation();
  event.preventDefault();
  interaction = {
    type: "connecting",
    sourceComponentIndex: compIndex,
    sourcePortLabel: portLabel,
    sourcePoint: worldPoint,
    currentPoint: worldPoint,
  };
}

function findHoveredTarget(
  point: { x: number; y: number },
  sourceIndex: number,
): { compIndex: number; portLabel: string | null } | null {
  const candidates = renderOrder.flatMap((i) => {
    if (i === sourceIndex) return [];
    const box = nodeBox(i);
    if (!box) return [];
    const key = componentKey(i);
    const compData = docStore.findComponent(key);
    const ports = compData && compData.ports.length > 0
      ? computePortPositions(box.width, box.height, compData.ports).map((
        p,
      ) => ({
        label: p.label,
        x: p.x,
        y: p.y,
      }))
      : [];
    return [{
      index: i,
      box,
      depth: depthOf(i, parentOf),
      ports,
    }];
  });

  return findConnectTarget(point, sourceIndex, candidates);
}

async function handleCreateConnection(
  sourceCompIndex: number,
  sourcePortLabel: string | null,
  targetCompIndex: number,
  targetPortLabel: string | null,
): Promise<void> {
  if (sourceCompIndex === targetCompIndex) return;

  const srcKey = componentKey(sourceCompIndex);
  const targetKey = componentKey(targetCompIndex);

  const srcParts = srcKey.split("/").filter(Boolean);
  const targetParts = targetKey.split("/").filter(Boolean);

  const srcCompLabel = srcParts[srcParts.length - 1];
  const targetCompLabel = targetParts[targetParts.length - 1];

  const srcParentPath = srcParts.slice(0, -1).join("/");
  const targetParentPath = targetParts.slice(0, -1).join("/");

  if (srcParentPath !== targetParentPath) {
    alert(
      "Connections can only wire sibling components within the same system or parent component.",
    );
    return;
  }

  const fromEndpoint = sourcePortLabel
    ? `${srcCompLabel}:${sourcePortLabel}`
    : srcCompLabel;
  const toEndpoint = targetPortLabel
    ? `${targetCompLabel}:${targetPortLabel}`
    : targetCompLabel;

  const defaultConnLabel = `conn-${srcCompLabel}-${targetCompLabel}`;
  const connLabel = prompt("Connection name?", defaultConnLabel)?.trim();
  if (!connLabel) return;

  const { path: targetPath, content: mainContent } = await readMainContent();
  const doc = new DocumentStore();
  if (mainContent.trim()) {
    doc.loadFromHcl(mainContent);
  }

  const added = doc.addConnection(srcParentPath, {
    label: connLabel,
    from: fromEndpoint,
    to: toEndpoint,
  });

  if (added) {
    await fs.writeFile(targetPath, doc.systemHcl);
    sources = await readProjectSources(fs);
  }
}

// Middle mouse button, or the left button while Space is held, always
// pans, regardless of what's under the cursor — including directly over a
// node, so it must be handled here too (not just in onCanvasMouseDown,
// which only sees clicks on empty canvas).
function onNodeMouseDown(event: MouseEvent, index: number) {
  // Auto-layout is actively writing node positions every frame; letting a
  // drag/select start at the same time would silently fight it (clicks
  // would visibly do nothing useful) — see the cursor style on <svg>
  // below for the matching "busy" affordance.
  if (autoLayoutRunning) return;
  if (event.button === 1 || (event.button === 0 && isSpaceHeld())) {
    event.preventDefault();
    interaction = {
      type: "panning",
      lastX: event.clientX,
      lastY: event.clientY,
    };
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();

  // One undo point per drag *gesture* (not per mousemove) — recorded here,
  // at mousedown, before anything moves.
  recordUndoPoint();

  // Clicking a node that isn't already part of the selection replaces the
  // selection with just that node. Clicking a node that's already
  // selected (as part of a multi-selection) keeps the whole selection, so
  // dragging it moves the whole group.
  if (!selected.has(index)) {
    selected.clear();
    selected.add(index);
  }

  const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
  const startPositions: Record<number, { x: number; y: number }> = {};
  for (const i of selected) {
    const box = checked[componentKey(i)];
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
  // See onNodeMouseDown's matching guard above.
  if (autoLayoutRunning) return;
  if (event.button === 1 || (event.button === 0 && isSpaceHeld())) {
    event.preventDefault();
    interaction = {
      type: "panning",
      lastX: event.clientX,
      lastY: event.clientY,
    };
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
  // See onNodeMouseDown's matching guard above.
  if (autoLayoutRunning) return;
  if (event.button !== 0) return;
  // Let a space-held click bubble up to the node's own mousedown handler,
  // which starts panning instead of a resize — keeps "how to start a pan"
  // in one place.
  if (isSpaceHeld()) return;
  event.preventDefault();
  event.stopPropagation();

  // One undo point per resize gesture, recorded before anything resizes.
  recordUndoPoint();

  const startBoxes: Record<number, Box> = {};
  for (const i of selected) {
    const box = nodeBox(i);
    if (box) startBoxes[i] = box;
  }
  const groupBox = unionBox(Object.values(startBoxes));
  interaction = { type: "resizing", anchorIndex: index, groupBox, startBoxes };
}

// Moves every node in `startPositions` (a snapshot of the whole selection
// taken when the drag began) by the same (deltaX, deltaY) offset from its
// own snapshot position — recomputed from the snapshot each event (not
// accumulated incrementally) to avoid drift. Each node still respects its
// own active-parent containment individually — if only some of the
// selection is constrained, the group may not move/scale perfectly
// rigidly/uniformly, but no node is ever allowed to escape its parent's
// box — and cascades containment to its own descendants. Shared by both
// applyGroupDelta and applyGroupScale below, since they only differ in
// how `next` is computed (a positional delta vs. a size/position scale).
function writeClampedToActiveParent(index: number, next: Box) {
  const ownParentBox = activeParentBox(index);
  const clamped = ownParentBox
    ? clampWithin(
      next,
      ownParentBox,
      CHILD_CONTAINMENT_MARGIN,
      CHILD_CONTAINMENT_TOP_MARGIN,
    )
    : next;
  setNodeBox(index, clamped);
  reclampChildren(index);
}

// Moves every node in `startPositions` (a snapshot of the whole selection
// taken when the drag began) by the same (deltaX, deltaY) offset from its
// own snapshot position — recomputed from the snapshot each event (not
// accumulated incrementally) to avoid drift. Shared by single- and
// multi-node drags alike, since a single dragged node is just a
// selection of one.
function applyGroupDelta(
  startPositions: Record<number, { x: number; y: number }>,
  deltaX: number,
  deltaY: number,
) {
  for (const [indexStr, start] of Object.entries(startPositions)) {
    const index = Number(indexStr);
    const box = nodeBox(index);
    if (!box) continue;
    const next: Box = {
      x: start.x + deltaX,
      y: start.y + deltaY,
      width: box.width,
      height: box.height,
    };
    writeClampedToActiveParent(index, next);
  }
}

// Scales every node in `startBoxes` (a snapshot of the whole selection
// taken when the resize began) by (scaleX, scaleY), applied to both
// position (relative to the selection's fixed top-left, `groupBox`) and
// size. Shared by single- and multi-node resizes alike, since a single
// resized node is just a selection of one.
function applyGroupScale(
  startBoxes: Record<number, Box>,
  groupBox: Box,
  scaleX: number,
  scaleY: number,
) {
  for (const [indexStr, startBox] of Object.entries(startBoxes)) {
    const index = Number(indexStr);
    const relX = startBox.x - groupBox.x;
    const relY = startBox.y - groupBox.y;
    const next: Box = {
      x: snap(groupBox.x + relX * scaleX),
      y: snap(groupBox.y + relY * scaleY),
      width: snap(Math.max(MIN_NODE_SIZE, startBox.width * scaleX)),
      height: snap(Math.max(MIN_NODE_SIZE, startBox.height * scaleY)),
    };
    writeClampedToActiveParent(index, next);
  }
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
            CHILD_CONTAINMENT_TOP_MARGIN,
          );
        }
        // The whole selection moves by the same delta the anchor (grabbed)
        // node moved by.
        const deltaX = anchorNext.x - anchorStart.x;
        const deltaY = anchorNext.y - anchorStart.y;
        applyGroupDelta(current.startPositions, deltaX, deltaY);

        // Check potential drop/reparent target candidate only if Alt is held
        if (event.altKey) {
          const candidateBoxes: { index: number; box: Box; depth: number }[] =
            [];
          for (const i of renderOrder) {
            if (i === current.anchorIndex || selected.has(i)) continue;
            if (components[i]?.leaf) continue;
            if (isDescendantOf(i, current.anchorIndex)) continue;
            const b = nodeBox(i);
            if (b) {
              candidateBoxes.push({
                index: i,
                box: b,
                depth: depthOf(i, parentOf),
              });
            }
          }
          const foundTarget = findReparentTarget(anchorNext, candidateBoxes);
          const currentParent = parentOf(current.anchorIndex);
          if (foundTarget !== null && foundTarget !== currentParent) {
            reparentTargetIndex = foundTarget;
          } else {
            reparentTargetIndex = null;
          }
        } else {
          reparentTargetIndex = null;
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
        // Group-resize is a uniform scale, derived from how much the
        // grabbed node's own box changed.
        const scaleX = rawWidth / anchorStart.width;
        const scaleY = rawHeight / anchorStart.height;
        applyGroupScale(current.startBoxes, current.groupBox, scaleX, scaleY);
      }
      return;
    }
    case "panning": {
      const dxScreen = event.clientX - current.lastX;
      const dyScreen = event.clientY - current.lastY;
      const zoom = editor_state.view.zoom;
      editor_state.view.x -= dxScreen / zoom;
      editor_state.view.y -= dyScreen / zoom;
      interaction = {
        type: "panning",
        lastX: event.clientX,
        lastY: event.clientY,
      };
      return;
    }
    case "connecting": {
      const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
      interaction = {
        ...current,
        currentPoint: svgCoords,
      };
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
  if (current.type === "connecting") {
    const target = findHoveredTarget(
      current.currentPoint,
      current.sourceComponentIndex,
    );
    if (target) {
      void handleCreateConnection(
        current.sourceComponentIndex,
        current.sourcePortLabel,
        target.compIndex,
        target.portLabel,
      ).catch(reportDiagramError);
    }
  }
  if (current.type === "dragging") {
    if (reparentTargetIndex !== null) {
      const srcKey = componentKey(current.anchorIndex);
      const targetKey = componentKey(reparentTargetIndex);
      reparentTargetIndex = null;
      void executeReparent(srcKey, targetKey).catch(reportDiagramError);
    }
  }
  if (current.type === "marquee") {
    // A marquee with negligible size is just a click: clear the selection
    // (matches the old "click empty canvas to deselect" behavior).
    // Otherwise, commit whatever the live preview (marqueeCandidates) was
    // already showing.
    const box = marqueeBox;
    selected.clear();
    if (box && (box.width > 2 || box.height > 2)) {
      for (const index of marqueeCandidates) selected.add(index);
    }
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
  Object.keys(checked)
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
  // Built fresh and returned as-is on every recomputation; reactivity
  // already comes from the surrounding $derived.by, not from mutating
  // this Set later.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
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

// Auto-layout animation budget: stop once the simulation has settled
// (alpha below this threshold), or after this many animation frames,
// whichever comes first — so a pathological/never-converging case can't
// spin forever.
const AUTO_LAYOUT_ALPHA_MIN = 0.005;
const AUTO_LAYOUT_MAX_FRAMES = 300;

// Also stops early once every node's combined movement in a single frame
// (summed Euclidean distance, in world units) drops below this —
// catches layouts that have practically stopped moving well before their
// alpha decays below AUTO_LAYOUT_ALPHA_MIN (small groups in particular
// can visually settle almost immediately while alpha keeps decaying for
// many more frames with no visible effect). Only checked after warmup
// (see AUTO_LAYOUT_WARMUP_TICKS below) finishes, since forces — and thus
// movement — are deliberately near-zero during the ramp-up itself.
const AUTO_LAYOUT_MIN_MOVEMENT = 0.5;

// Fraction of the frame budget spent ramping forces up from ~0 to full
// strength, instead of applying at full strength from frame 1 — avoids
// the sharp jump an instant full-strength start would otherwise cause.
const AUTO_LAYOUT_WARMUP_FRACTION = 0.1;
const AUTO_LAYOUT_WARMUP_TICKS = Math.round(
  AUTO_LAYOUT_MAX_FRAMES * AUTO_LAYOUT_WARMUP_FRACTION,
);

// Whether an auto-layout animation is currently running — disables the
// "Auto Layout" button so a second run can't start and race the first
// one over the same node positions.
let autoLayoutRunning = $state(false);

// Runs a force-directed auto-layout pass over the target set of nodes:
// the current selection if non-empty, otherwise every currently-placed
// node at any level. The target set is partitioned into sibling groups
// (groupBySiblings, keyed by immediate parent) and each group gets its
// own independent simulation, confined around its own parent's current
// box (or its own combined bounding box, for a top-level group or an
// orphaned nested group whose parent isn't itself placed) — rather than
// one flat simulation mixing unrelated hierarchy levels together. See
// TASKS.md Task 50 for why: a node shouldn't be repelled by/attracted to
// a node it isn't actually a sibling of. Every result is still written
// through the same clamp-to-active-parent-and-cascade path a live drag
// uses, regardless of grouping, as a containment safety net. All groups'
// simulations are driven together, frame-by-frame, via
// requestAnimationFrame, rather than jumping straight to the converged
// layout.
function runAutoLayout() {
  if (autoLayoutRunning) return;

  const targetIndices = selected.size > 0 ? [...selected] : renderOrder;

  const layoutNodes: LayoutNode[] = targetIndices.flatMap((index) => {
    const box = nodeBox(index);
    return box ? [{ index, box }] : [];
  });
  if (layoutNodes.length < 2) return; // nothing meaningful to arrange

  // One undo point for the whole auto-layout run, recorded before the
  // animation starts — not per-frame.
  recordUndoPoint();

  const groups = groupBySiblings(layoutNodes, parentOf);
  const groupLayouts = [...groups.entries()].map(
    ([parentIndex, groupNodes]) => {
      const groupIndexSet = new Set(groupNodes.map((n) => n.index));
      const groupEdges: LayoutEdge[] = connections
        .filter(
          (conn) => groupIndexSet.has(conn.from) && groupIndexSet.has(conn.to),
        )
        .map((conn) => ({ from: conn.from, to: conn.to }));

      // Centers each group's simulation on its own parent's current box
      // (if that parent is itself placed on canvas), so a nested group
      // stays roughly where its parent already is; falls back to the
      // group's own combined bounding box otherwise (top-level, or a
      // nested group whose parent isn't shown).
      const parentBox = parentIndex !== undefined ? nodeBox(parentIndex) : null;
      const bounds = parentBox ?? unionBox(groupNodes.map((n) => n.box));
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;

      return createForceLayout(groupNodes, groupEdges, {
        centerX,
        centerY,
        warmupTicks: AUTO_LAYOUT_WARMUP_TICKS,
      });
    },
  );

  autoLayoutRunning = true;
  let frame = 0;

  // Seeded from each node's starting box, so the very first frame's
  // movement is measured against where it actually began — updated to
  // that frame's result at the end of every step() below. Plain,
  // non-reactive local state (never rendered/read outside this closure),
  // so it doesn't need SvelteMap's reactivity.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const previousPositions = new Map<number, { x: number; y: number }>(
    layoutNodes.map((n) => [n.index, { x: n.box.x, y: n.box.y }]),
  );

  function step() {
    frame += 1;

    let allSettled = true;
    const allResults: { index: number; x: number; y: number }[] = [];
    for (const layout of groupLayouts) {
      allResults.push(...layout.tick());
      if (layout.alpha() >= AUTO_LAYOUT_ALPHA_MIN) allSettled = false;
    }

    let totalMovement = 0;
    for (const result of allResults) {
      const previous = previousPositions.get(result.index);
      if (previous) {
        totalMovement += Math.hypot(
          result.x - previous.x,
          result.y - previous.y,
        );
      }
      previousPositions.set(result.index, { x: result.x, y: result.y });
    }
    const barelyMoving = frame > AUTO_LAYOUT_WARMUP_TICKS &&
      totalMovement < AUTO_LAYOUT_MIN_MOVEMENT;

    // Only snap the final settling frame, not every intermediate one:
    // snapping every frame while snapping is active would force the
    // whole animation to jump in SNAP_GRID_SIZE-sized steps instead of
    // settling smoothly. Since every frame overwrites the previous one's
    // written position anyway, only the last write actually matters for
    // the visible result — so it's the only one that needs to respect
    // the grid.
    const converged = allSettled || barelyMoving ||
      frame >= AUTO_LAYOUT_MAX_FRAMES;

    for (const result of allResults) {
      const box = nodeBox(result.index);
      if (!box) continue;
      writeClampedToActiveParent(result.index, {
        x: converged ? snap(result.x) : result.x,
        y: converged ? snap(result.y) : result.y,
        width: box.width,
        height: box.height,
      });
    }

    if (converged) {
      autoLayoutRunning = false;
    } else {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

// Small "what's happening right now" hint shown in the canvas's
// bottom-right corner — purely informational, no effect on behavior.
// Deliberately skips "panning" (purely a viewport/navigation action, not
// an edit — a text label for it would just be noise) and
// "idle"/"marquee-not-yet-started" (nothing to announce).
// A one-shot "pulse" label (e.g. "Undo"/"Redo") for actions that
// complete instantly rather than persisting as an interaction state—
// unlike dragging/resizing/etc., there's no ongoing state to derive a
// label from, so flashActivity() below sets this directly. It's cleared
// again on the very next tick (not immediately), so `currentActivity`
// briefly sees it as "active" — just like a real interaction state —
// letting the exact same sustain/fade-out effect further down handle the
// rest, rather than needing a second parallel mechanism.
let pulseActivity: string | null = $state(null);

function flashActivity(label: string) {
  pulseActivity = label;
}

$effect(() => {
  if (pulseActivity === null) return;
  const id = setTimeout(() => {
    pulseActivity = null;
  }, 0);
  return () => clearTimeout(id);
});

let currentActivity = $derived.by((): string | null => {
  if (pulseActivity !== null) return pulseActivity;
  if (autoLayoutRunning) return "Calculating…";
  switch (interaction.type) {
    case "dragging":
      return "Dragging";
    case "connecting":
      return "Connecting";
    case "resizing":
      return "Resizing";
    case "marquee": {
      // A marquee this small is really just a click (same threshold
      // onSvgMouseUp uses to decide whether to commit a selection) —
      // most commonly a click on empty canvas to *deselect*, which isn't
      // meaningfully "selecting" anything and shouldn't announce itself
      // as such.
      const box = marqueeBox;
      if (!box || (box.width <= 2 && box.height <= 2)) return null;
      return "Selecting";
    }
    default:
      return null;
  }
});

// Fade timing for the hint below, in ms — kept as separate tweakable
// constants (rather than baked into Tailwind duration classes) so they
// can be adjusted without touching markup.
const ACTIVITY_HINT_FADE_IN_MS = 100;
const ACTIVITY_HINT_SUSTAIN_MS = 500;
const ACTIVITY_HINT_FADE_OUT_MS = 400;

let activityHintLabel: string | null = $state(null);
let activityHintVisible = $state(false);

// Shows the hint immediately when a new activity starts. When it ends,
// keeps showing the *last* label for ACTIVITY_HINT_SUSTAIN_MS before
// starting the (slower) fade-out — cancelled automatically (via this
// effect's cleanup, which Svelte runs before every re-execution) if a
// new activity begins before that sustain period elapses, so quick
// back-to-back activities never visibly flicker out and back in.
$effect(() => {
  const label = currentActivity;
  if (label !== null) {
    activityHintLabel = label;
    activityHintVisible = true;
    return;
  }
  const timeout = setTimeout(() => {
    activityHintVisible = false;
  }, ACTIVITY_HINT_SUSTAIN_MS);
  return () => clearTimeout(timeout);
});
</script>

<svelte:window onkeydown={onDiagramKeyDown} />

<div class="flex flex-row flex-1 w-full overflow-hidden">
  <!--
    Left sidebar: inspector (top) + diagram picker (bottom), sharing one
    w-64 column instead of two, to leave more horizontal room for the
    canvas. Always rendered (even with nothing selected) so it keeps a
    fixed w-64 slot in this flex row — toggling it in/out of the DOM
    would resize the canvas column next to it (since it's flex-1), which
    changes canvas_width/canvas_height and jumps the whole viewBox on
    every selection change.
  -->
  <aside
    class="w-64 shrink-0 bg-base-100 text-base-content p-4 overflow-y-auto border-r border-base-300 flex flex-col"
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
    {:else if selectedKey && selectedComponentData}
      <NodeInspector
        componentKey={selectedKey}
        component={selectedComponentData}
        textAlign={selectedBox?.textAlign ?? DEFAULT_TEXT_ALIGN}
        onupdate={(patch) =>
          void handleUpdateSelectedComponent(patch).catch(reportDiagramError)}
        onrename={(newLabel) =>
          void handleRenameSelectedComponent(newLabel).catch(reportDiagramError)}
        onsettextalign={(align) => setSelectedTextAlign(align)}
        ondelete={() =>
          void handleDeleteSelectedComponent().catch(reportDiagramError)}
      />
    {:else}
      <p class="text-base-content/50 text-sm">
        Select a component on the canvas to edit its properties.
      </p>
    {/if}

    <div class="divider"></div>

    <h3
      class="font-semibold text-sm mb-3 text-base-content/70 uppercase tracking-wide"
    >
      Diagrams
    </h3>
    <FileTree
      entries={diagramEntries}
      bind:selectedPath={selectedDiagramPath}
      oncreatefile={handleCreateDiagram}
      oncreatedirectory={handleCreateDiagramFolder}
      onrename={handleRenameDiagram}
      ondelete={handleDeleteDiagram}
    />
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
        style="cursor: {autoLayoutRunning
          ? 'wait'
          : interaction.type === 'dragging' ||
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
            {#each minorGridLines as i (i)}
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
          ondblclick={onCanvasDblClick}
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
          {@const compKey = componentKey(index)}
          {@const compData = docStore.findComponent(compKey)}
          {@const portPositions = compData && compData.ports.length > 0
            ? computePortPositions(width, height, compData.ports)
            : []}
          <g
            transform="translate({x}, {y})"
            onmousedown={(e) => onNodeMouseDown(e, index)}
            ondblclick={(e) => onNodeDblClick(e, index)}
            style="cursor: {autoLayoutRunning ? 'wait' : 'grab'}"
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
            {#if reparentTargetIndex === index}
              <rect
                x={-4}
                y={-4}
                width={width + 8}
                height={height + 8}
                rx="8"
                fill="none"
                stroke="var(--color-primary)"
                stroke-width="2"
                stroke-dasharray="4 4"
                class="animate-pulse"
                style="pointer-events: none"
              />
            {/if}
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

            <!-- Port handles (visible when selected or actively dragging a connection) -->
            {#if selected.has(index) || interaction.type === "connecting"}
              {#if portPositions.length > 0}
                {#each portPositions as port (port.label)}
                  {@const portFill = port.role === "provider"
                    ? "var(--color-success)"
                    : port.role === "consumer"
                    ? "var(--color-warning)"
                    : "var(--color-info)"}
                  <g transform="translate({port.x}, {port.y})">
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle
                      r="8"
                      fill="transparent"
                      class="cursor-crosshair"
                      onmousedown={(e) =>
                        onPortMouseDown(e, index, port.label, {
                          x: x + port.x,
                          y: y + port.y,
                        })}
                    >
                      <title
                      >{port.label} ({port.role}, {port.protocol ||
                          "untyped"})</title>
                    </circle>
                    <circle
                      r="4"
                      fill={portFill}
                      stroke="var(--color-base-100)"
                      stroke-width="1.5"
                      style="pointer-events: none"
                    />
                  </g>
                {/each}
              {:else}
                <!-- Generic connection handle for component with no ports -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <g transform="translate({width}, {height / 2})">
                  <circle
                    r="8"
                    fill="transparent"
                    class="cursor-crosshair"
                    onmousedown={(e) =>
                      onPortMouseDown(e, index, null, {
                        x: x + width,
                        y: y + height / 2,
                      })}
                  >
                    <title>Drag to connect component</title>
                  </circle>
                  <circle
                    r="3.5"
                    fill="var(--color-base-content)"
                    fill-opacity="0.5"
                    stroke="var(--color-base-100)"
                    stroke-width="1"
                    style="pointer-events: none"
                  />
                </g>
              {/if}
            {/if}

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
                style="cursor: {autoLayoutRunning ? 'wait' : 'nwse-resize'}"
                onmousedown={(e) => onResizeHandleMouseDown(e, index)}
              />
            {/if}
          </g>
        {/snippet}

        {#each renderOrder as index (index)}
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
        {#each visibleConnections as { conn, a, b, orientation } (`${conn.label}-${conn.from}-${conn.to}`)}
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

        {#if interaction.type === "connecting"}
          <path
            d={elbowPath(
              interaction.sourcePoint.x,
              interaction.sourcePoint.y,
              interaction.currentPoint.x,
              interaction.currentPoint.y,
              "horizontal",
            )}
            fill="none"
            stroke="var(--color-primary)"
            stroke-width="2"
            stroke-dasharray="4 4"
            marker-end="url(#arrow)"
            class="animate-pulse"
            style="pointer-events: none"
          />
        {/if}

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

      {#if !model && output.error_count() > 0}
        <div
          class="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
        >
          <div
            class="card bg-base-100/95 border border-error/50 shadow-2xl p-6 text-center max-w-md pointer-events-auto backdrop-blur-xs"
          >
            <div class="text-error text-3xl mb-2">⚠️</div>
            <h3 class="font-bold text-lg text-error mb-1">
              Model failed to compile
            </h3>
            <p class="text-sm text-base-content/70 mb-3">
              {output.error_count()} error{output.error_count() > 1
                ? "s"
                : ""} detected in the system model. Check the code in the editor!
            </p>
            {#if firstError}
              <div
                class="bg-base-200 p-2.5 rounded text-xs font-mono text-left text-error/90 mb-4 border border-error/20 truncate"
                title={firstError.message}
              >
                <span class="font-bold">[{firstError.code}]</span>
                {firstError.message}
              </div>
            {/if}
            <a
              href={resolve("/projects/[id]/editor", { id: data.projectId })}
              class="btn btn-sm btn-error"
            >
              Open Editor to Fix
            </a>
          </div>
        </div>
      {/if}

      <DiagramToolbar
        bind:snapEnabled
        {snapActive}
        bind:snapGridSize={snapGridSize.value}
        snapGridSizeOptions={SNAP_GRID_SIZE_OPTIONS}
        bind:gridVisible
        {autoLayoutRunning}
        onautolayout={runAutoLayout}
        onzoomtofill={zoomToFill}
        onresetview={() => reset_view(editor_state)}
        onaddsystem={() => void handleAddSystem().catch(reportDiagramError)}
        onaddcomponent={() => openCreateComponentModal()}
      />

      <div
        class="absolute bottom-2 right-2 z-10 pointer-events-none bg-base-100 border border-base-300 rounded-box shadow px-3 py-1 text-sm text-base-content/80"
        style="opacity: {activityHintVisible ? 1 : 0}; transition-property: opacity; transition-duration: {activityHintVisible
          ? ACTIVITY_HINT_FADE_IN_MS
          : ACTIVITY_HINT_FADE_OUT_MS}ms;"
      >
        {activityHintLabel ?? ""}
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

    {#if selectedDiagramPath === null}
      <p class="text-base-content/50 text-sm">
        No diagram selected.<br />Create one from the Diagrams sidebar.
      </p>
    {:else if components.length === 0}
      <p class="text-base-content/50 text-sm">
        No components found.<br />Open the editor and define some systems.
      </p>
    {:else}
      <ul class="space-y-1">
        {#each components as component, index (index)}
          <li class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              id="comp-{index}"
              class="checkbox checkbox-xs"
              checked={!!checked[componentKey(index)]}
              onchange={(value) => {
                recordUndoPoint();
                if (value.currentTarget.checked) {
                  // Restore the remembered layout if this component has
                  // been placed before (even if it was later unchecked),
                  // instead of always resetting to the default position.
                  const remembered = savedLayout[componentKey(index)];
                  let box: Box = {
                    x: remembered?.x ?? 100,
                    y: remembered?.y ?? 100,
                    width: remembered?.width ?? DEFAULT_NODE_WIDTH,
                    height: remembered?.height ?? DEFAULT_NODE_HEIGHT,
                  };
                  const parentBox = activeParentBox(index);
                  if (parentBox) {
                    box = clampWithin(
                      box,
                      parentBox,
                      CHILD_CONTAINMENT_MARGIN,
                      CHILD_CONTAINMENT_TOP_MARGIN,
                    );
                  }
                  setNodeBox(index, {
                    ...box,
                    textAlign: remembered?.textAlign ?? DEFAULT_TEXT_ALIGN,
                  });
                  // In case this component is itself the parent of children
                  // that were already placed on canvas before it was.
                  reclampChildren(index);
                } else {
                  delete checked[componentKey(index)];
                  // savedLayout[componentKey(index)] is intentionally left
                  // alone, so re-checking this component later restores it
                  // here.
                  selected.delete(index);
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
      {#each connections as connection (`${connection.label}-${connection.from}-${connection.to}`)}
        <li class="flex items-center gap-2 text-sm">
          {connection.label}
        </li>
      {/each}
    </ul>
  </aside>
</div>

<CreateComponentModal
  isOpen={isCreateModalOpen}
  {availableParents}
  defaultParentKey={createModalDefaultParent}
  initialPosition={createModalPosition}
  oncreate={(data) => void handleModalCreateComponent(data).catch(reportDiagramError)}
  onclose={() => (isCreateModalOpen = false)}
/>
