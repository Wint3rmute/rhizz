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
import type { PageProps } from "./$types";
import FileTree from "../editor/FileTree.svelte";
import ComponentHierarchyTree from "./ComponentHierarchyTree.svelte";
import DiagramToolbar from "./DiagramToolbar.svelte";
import NodeInspector from "./NodeInspector.svelte";
import CreateComponentModal from "./CreateComponentModal.svelte";
import EmbedDiagramButton from "./EmbedDiagramButton.svelte";
import {
  type ComponentData,
  DocumentStore,
  type PortData,
} from "../../../../DocumentStore.svelte";

import {
  type Annotation,
  buildKeyToIndexMap,
  componentKey,
  DIAGRAM_LAYOUT_DIR,
  type DiagramLayout,
  emptyDiagramLayout,
  readDiagramLayoutFile,
  type StoredBox,
  type StoredConnection,
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
  boxContains,
  clampWithin,
  computeDirectionalHandles,
  computeLcaConnection,
  computePortPositions,
  computeRenderOrder,
  computeResizedBox,
  computeVisibleConnections,
  depthOf,
  elbowPath,
  findConnectTarget,
  findReparentTarget,
  MIN_NODE_SIZE,
  type ResizeHandle,
  textPosition,
  unionBox,
} from "./geometry";
import type { Box, ConnectionSide, TextAlign } from "./geometry";
import { resolveIcon } from "../../../../iconHelper";
import {
  borderStyleToSvg,
  COLOR_OPTIONS,
  fontStyleToSvg,
  SELECTION_OUTLINE_DASHARRAY,
  SELECTION_OUTLINE_OPACITY,
  selectionOutlineRect,
} from "./visuals";
import {
  buildGraduatedGridPatterns,
  GRID_BASE_SPACING,
  GRID_GRADUATIONS,
} from "./grid";
import { asTestScript, createActionLog } from "../../../../actionLog";
import { copyDebugScript } from "../../../../actionLogConsole";
import { subscribeToMutations } from "../../../../DocumentStore.svelte";

const editor_state = create_editor_state("DIAGRAM_VIEW");
let root_svg: SVGElement;

// Records every durable model mutation the user makes on this canvas (see
// actionLog.ts). Mutations are captured through DocumentStore's opt-in module-
// level mutation observer rather than per-handler calls, so the trace covers
// every route and the page stays free of scattered logging. Cleared when a new
// project is loaded.
const actionLog = createActionLog();
let copiedDebug = $state(false);

// Pre-session baseline of the primary system HCL, captured once when the action
// log is cleared (project load) — i.e. the state *before* any logged mutation.
// Used by handleCopyDebug as the replay seed; the current on-disk content would
// already include the session's mutations and double-apply them.
let debugBaselineHcl = "";

subscribeToMutations((action) => {
  actionLog.record(action);
});

async function handleCopyDebug(): Promise<void> {
  // Seed the replay from the pre-session baseline captured at project load,
  // NOT the current on-disk content (which already includes this session's
  // mutations and would double-apply them).
  const baselineHcl = debugBaselineHcl;
  const script = asTestScript(actionLog.actions(), docStore.systemHcl, {
    baselineHcl,
  });
  await copyDebugScript(actionLog, docStore.systemHcl, baselineHcl);
  console.log(script);
  copiedDebug = true;
  setTimeout(() => {
    copiedDebug = false;
  }, 2000);
}

// Tracks the canvas's rendered pixel size so the SVG viewBox can match it
// exactly (1 SVG unit == 1 pixel), keeping the canvas filling all
// available space with no letterboxing regardless of viewport size.
let canvas_width = $state(800);
let canvas_height = $state(600);

// Background grid: a chain of nested SVG patterns, one per "graduation"
// level, built from the constants in grid.ts. Tweak the ladder there and the
// canvas follows — no other code depends on the specific values. The
// GRID_BASE_SPACING matches the default node size snapped to the finest
// level, so the grid doubles as a snapping guide.
const gridPatterns = buildGraduatedGridPatterns(
  GRID_GRADUATIONS,
  GRID_BASE_SPACING,
  "Grid",
);
// The pattern id the canvas rect fills with — the coarsest level, which
// draws every finer level beneath it.
const gridFillId = gridPatterns[gridPatterns.length - 1]?.id ?? "Grid";

let { data }: PageProps = $props();

let fs = $derived(openProjectFs(projectStore, data.projectId));

let sources = $state<Source[]>([]);
$effect(() => {
  void readProjectSources(fs).then((s) => {
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
// if the component itself (or an ancestor) is renamed or reparented.
function getComponentKey(index: number): string {
  return componentKey(index, components, systems);
}

// Reverse lookup from a persistence key back to the component's current
// arena index, rebuilt whenever `components`/`systems` change. Entries in
// `checked`/`savedLayout` whose key isn't found here belong to a component
// that no longer exists (renamed, removed, or reparented) and are simply
// not rendered.
let keyToIndex = $derived.by(() => {
  return buildKeyToIndexMap(components, systems);
});

// The set of arena indices currently placed on the canvas, derived from
// `checked` (keyed by structural componentKey) via the reverse key→index map.
let checkedIndices = $derived.by(() => {
  const placed = new SvelteSet<number>();
  for (const key of Object.keys(checked)) {
    const index = keyToIndex.get(key);
    if (index !== undefined) placed.add(index);
  }
  return placed;
});

// Default node size, in world (SVG) units, for newly-placed nodes and for
// backfilling entries persisted before per-node sizing existed.
const DEFAULT_NODE_WIDTH = 100;
const DEFAULT_NODE_HEIGHT = 100;

// User-selectable snap grid sizes, in world units, offered by the
// dropdown next to the "Snap to Grid" button. A fixed set (rather than a
// free-form numeric input) keeps the choices "nice" round numbers that
// also line up with the grid's graduation levels in grid.ts.
const SNAP_GRID_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_SNAP_GRID_SIZE: number = SNAP_GRID_SIZE_OPTIONS[0];

// How many world units position/size snap to when "snap to grid" (below)
// is enabled. Separate from the grid's base spacing so it can be tuned
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
// Enabled by default; holding Ctrl/Cmd temporarily disables it.
let snapEnabled = $state(true);

// Whether snapping is actually in effect right now: the toggle is on AND
// the modifier key (Ctrl/Cmd) is not currently held as a quick temporary
// override. A $derived (rather than inlining the check into snap()) so the
// "Snap to Grid" button can also reflect the live modifier-key override,
// not just the persistent toggle.
let snapActive = $derived(snapEnabled && !isModifierHeld());

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

// Hit area dimensions for edge and corner resize handles
const CORNER_HANDLE_SIZE = 10;
const EDGE_HANDLE_THICKNESS = 6;

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
let savedConnections = $state<Record<string, StoredConnection>>({});
let annotations = $state<Annotation[]>([]);
// Indices into `annotations` currently selected (for drag/delete).
// SvelteSet (not a plain Set in $state) so in-place add/delete/clear are
// tracked and the outline re-renders — mirrors the node `selectedKeys`.
let selectedAnnotations = new SvelteSet<number>();
// When editing an annotation's text inline (index, or null when not editing).
let editingAnnotation = $state<number | null>(null);
// The annotation object currently being edited (undefined when not editing).
let editingAnnotationObj = $derived(
  editingAnnotation === null ? undefined : annotations[editingAnnotation],
);

// Which diagram (a `diagrams/<name>.hcl` file) is currently open on the
// canvas, relative to DIAGRAM_LAYOUT_DIR — e.g. "main.hcl" — exactly like
// the editor's own `selectedPath` is relative to the project root. `null`
// means no diagram exists yet (or none is selected), in which case the
// canvas below simply has nothing placed on it.
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

// Picks a sensible default diagram to open: the first ".hcl" file found
// (in practice "main.hcl" — see the auto-seed below), or `null` if the
// project has no diagrams at all yet.
function firstDiagramPath(): string | null {
  return (
    diagramEntries.find(
      (e) => e.isFile() && e.name.endsWith(".hcl"),
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
  actionLog.clear();
  // Snapshot the pre-session content of the primary system HCL file so the
  // debug replay seeds from the state before any of this session's mutations.
  void readMainContent().then(({ content }) => {
    debugBaselineHcl = content;
  });
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
          systems[0]?.label || "",
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
// Monotonic stamp bumped on any user diagram mutation (adding/moving a node,
// editing an annotation). The load effect records the stamp when a read
// starts and only applies the result if no mutation happened in the meantime
// — so a slow read can never clobber edits made while it was in flight.
let diagramEditStamp = 0;
let loadStartStamp = 0;

// Called by every user-diagram mutation path so the load race guard works.
function noteDiagramEdited(): void {
  diagramEditStamp += 1;
}

$effect(() => {
  const path = fullDiagramPath;
  if (path === loadedDiagramPath) return;
  loadedDiagramPath = path;
  diagramLayoutLoaded = false;
  loadStartStamp = diagramEditStamp;

  if (path === null) {
    checked = {};
    savedLayout = {};
    savedConnections = {};
    annotations = [];
    return;
  }

  void readDiagramLayoutFile(fs, path).then((layout) => {
    // A stale load (e.g. rapid switching between diagrams) could resolve
    // after a newer one already changed the selection — guard against
    // overwriting the newer selection's state with the older one.
    if (loadedDiagramPath !== path) return;
    // If the user edited the diagram while this read was in flight, don't
    // clobber their changes with the (possibly empty) file contents — but
    // still mark the diagram as loaded so the save effect is armed and can
    // persist the user's edits.
    const editedDuringLoad = diagramEditStamp !== loadStartStamp;
    if (!editedDuringLoad) {
      checked = layout.checked;
      savedLayout = layout.savedLayout;
      savedConnections = layout.connections ?? {};
      annotations = layout.annotations ?? [];
    }
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
  const snapshot: DiagramLayout = {
    checked: $state.snapshot(checked),
    savedLayout: $state.snapshot(savedLayout),
    connections: $state.snapshot(savedConnections),
    annotations: $state.snapshot(annotations),
  };
  const path = fullDiagramPath;
  if (!diagramLayoutLoaded || path === null) return;
  void writeDiagramLayoutFile(fs, path, snapshot, systems[0]?.label || "");
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
      systems[0]?.label || "",
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
  noteDiagramEdited();
  const key = getComponentKey(index);
  const checkedPrev = checked[key];
  const savedPrev = savedLayout[key];
  checked[key] = {
    x: box.x ?? checkedPrev?.x ?? 0,
    y: box.y ?? checkedPrev?.y ?? 0,
    width: box.width ?? checkedPrev?.width,
    height: box.height ?? checkedPrev?.height,
    textAlign: box.textAlign ?? checkedPrev?.textAlign,
  };
  savedLayout[key] = {
    x: box.x ?? savedPrev?.x ?? 0,
    y: box.y ?? savedPrev?.y ?? 0,
    width: box.width ?? savedPrev?.width,
    height: box.height ?? savedPrev?.height,
    textAlign: box.textAlign ?? savedPrev?.textAlign,
  };
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
  const pos = checked[getComponentKey(index)];
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
  if (primarySelected === null || primarySelected === undefined) return;
  const box = checked[getComponentKey(primarySelected)];
  if (!box) return;
  if (box.textAlign === align) return; // no-op: skip a redundant undo point
  recordUndoPoint();
  setNodeBox(primarySelected, { textAlign: align });
}

// Places (checks) or unplaces (unchecks) a component on the canvas. This is
// the single source of truth for the sidebar's checkbox — both the old flat
// list and the new ComponentHierarchyTree route through it.
function toggleComponentChecked(index: number) {
  recordUndoPoint();
  if (checked[getComponentKey(index)]) {
    // Unplace.
    delete checked[getComponentKey(index)];
    // savedLayout[getComponentKey(index)] is intentionally left alone, so
    // re-checking this component later restores it where it was.
    deselect(index);
    return;
  }

  // Restore the remembered layout if this component has been placed before
  // (even if it was later unchecked), instead of always resetting to the
  // default position.
  const remembered = savedLayout[getComponentKey(index)];
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
  // In case this component is itself the parent of children that were
  // already placed on canvas before it was.
  reclampChildren(index);
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

// Currently selected nodes, tracked by stable qualified component key rather
// than the compiled model's arena index. Arena indices are rebuilt on every
// compile and may change even when the logical model is unchanged.
const selectedKeys = new SvelteSet<string>();
let selected = $derived.by(() => {
  const indices = new SvelteSet<number>();
  for (const key of selectedKeys) {
    const index = keyToIndex.get(key);
    if (index !== undefined) indices.add(index);
  }
  return indices;
});

function selectOnly(index: number) {
  selectedKeys.clear();
  selectedAnnotations.clear();
  selectedKeys.add(getComponentKey(index));
}

function clearSelection() {
  selectedKeys.clear();
  selectedAnnotations.clear();
}

function selectAnnotation(index: number) {
  selectedAnnotations.clear();
  selectedKeys.clear();
  selectedAnnotations.add(index);
}

function addAnnotationHandler(): void {
  noteDiagramEdited();
  // Place at the canvas center (world coords) if we can, else 0,0.
  const x = editor_state.view.x + canvas_width / 2 / editor_state.view.zoom;
  const y = editor_state.view.y + canvas_height / 2 / editor_state.view.zoom;
  const idx = annotations.length;
  annotations.push({ text: "New note", x, y });
  selectAnnotation(idx);
  editingAnnotation = idx;
}

function deleteSelectedAnnotations(): void {
  if (selectedAnnotations.size === 0) return;
  noteDiagramEdited();
  const toDelete = [...selectedAnnotations].sort((a, b) => b - a);
  for (const idx of toDelete) annotations.splice(idx, 1);
  selectedAnnotations.clear();
}

function deselect(index: number) {
  selectedKeys.delete(getComponentKey(index));
}

function select(index: number) {
  // Selecting a node drops annotation selection: the two selection modes
  // are mutually exclusive (mirrors selectAnnotation clearing node keys).
  selectedAnnotations.clear();
  selectedKeys.add(getComponentKey(index));
}

// Snapshot of the diagram's persisted content — the unit of undo/redo
// history. Deliberately excludes `selected` (transient UI state, not
// diagram content, and not guaranteed to still make sense after
// restoring an older/newer snapshot) and view/grid/snap preferences.
type DiagramSnapshot = {
  checked: Record<string, StoredBox>;
  savedLayout: Record<string, StoredBox>;
  connections: Record<string, StoredConnection>;
};

// How many undo steps (and, independently, redo steps) are kept.
const UNDO_HISTORY_LIMIT = 100;
const diagramHistory = createHistoryStack<DiagramSnapshot>();

function snapshotDiagram(): DiagramSnapshot {
  return {
    checked: { ...checked },
    savedLayout: { ...savedLayout },
    connections: { ...savedConnections },
  };
}

function applyDiagramSnapshot(snapshot: DiagramSnapshot) {
  checked = { ...snapshot.checked };
  savedLayout = { ...snapshot.savedLayout };
  savedConnections = { ...(snapshot.connections || {}) };
  clearSelection();
  selectedConnection = null;
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

// Handles the diagram keyboard shortcuts. Scoped to this page (via the
// <svelte:window> binding below), rather than living in the app-wide
// KeyboardState.svelte module, since "undo" here specifically means
// "undo a diagram edit" — a different page (e.g. the HCL text editor)
// would want its own, unrelated undo behavior.
//
// The t/b/c/f attribute-cycling shortcuts only fire while the canvas has
// focus (canvasFocused) and no modifier is held, so they never trigger
// while typing in the inspector or the HCL editor.
function onDiagramKeyDown(event: KeyboardEvent) {
  const primary = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (primary) {
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undoDiagramEdit();
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      redoDiagramEdit();
    }
    return;
  }

  // Attribute cycling: only when the canvas is focused and no modifier held.
  if (canvasFocused && !event.altKey && !event.shiftKey) {
    if (key === "t" || key === "b" || key === "c" || key === "f") {
      event.preventDefault();
      cycleSelectedAttribute(key);
    }
  }

  // Delete key: delete the selected connection, selected annotation, or the
  // selected component. Only fires when the canvas is focused (so it never
  // triggers while typing in the inspector or HCL editor).
  if (canvasFocused && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    if (selectedAnnotations.size > 0) {
      deleteSelectedAnnotations();
    } else if (selectedConnection) {
      void handleDeleteSelectedConnection(true).catch(reportDiagramError);
    } else if (selectedKey) {
      void handleDeleteSelectedComponent().catch(reportDiagramError);
    }
  }
}

// The single selected node, or null if zero or more than one are selected.
// Used wherever an operation only makes sense for exactly one node (the
// inspector's details/text-alignment controls).
let primarySelected = $derived(
  selected.size === 1 ? [...selected][0] : null,
);
let selectedBox = $derived(
  primarySelected !== null && primarySelected !== undefined
    ? nodeBox(primarySelected)
    : null,
);

// Whether the canvas (the SVG) currently has keyboard focus. The t/b/c/f
// attribute-cycling shortcuts below only fire while the canvas is focused,
// so they never trigger while the user is typing in the inspector or the
// HCL editor.
let canvasFocused = $state(false);

// The ordered value sets the t/b/c/f shortcuts cycle through, matching the
// choices offered by the component inspector. The first entry is the
// "unset" value (undefined), so cycling starts from the default.
const TEXT_ALIGN_CYCLE: TextAlign[] = ["center", "top-center", "top-left"];
const BORDER_CYCLE: ("solid" | "dashed" | "dotted")[] = [
  "solid",
  "dashed",
  "dotted",
];
const FONT_CYCLE: ("bold" | "italic" | "underline")[] = [
  "bold",
  "italic",
  "underline",
];
// COLOR_OPTIONS is imported from ./visuals; "none" (undefined) is the unset
// state, then cycle through the theme colors.

// Returns the next value after `current` in `cycle`, wrapping around to the
// first. `current` may be undefined (the unset state).
function nextInCycle<T>(cycle: readonly T[], current: T | undefined): T {
  const idx = current === undefined ? -1 : cycle.indexOf(current);
  return cycle[(idx + 1) % cycle.length] as T;
}

// Cycles the selected component's attribute on the t/b/c/f shortcuts.
// Only fires when exactly one node is selected and the canvas has focus.
function cycleSelectedAttribute(key: string) {
  if (primarySelected === null || primarySelected === undefined) return;
  const comp = selectedComponentData;
  if (!comp) return;

  switch (key) {
    case "t": {
      const next = nextInCycle(TEXT_ALIGN_CYCLE, selectedBox?.textAlign);
      setSelectedTextAlign(next);
      break;
    }
    case "b": {
      const next = nextInCycle(
        BORDER_CYCLE,
        comp.border as
          | "solid"
          | "dashed"
          | "dotted"
          | undefined,
      );
      void handleUpdateSelectedComponent({
        border: next === "solid" ? undefined : next,
      }).catch(reportDiagramError);
      break;
    }
    case "c": {
      const next = nextInCycle(
        COLOR_OPTIONS,
        comp.color as
          | (typeof COLOR_OPTIONS)[number]
          | undefined,
      );
      void handleUpdateSelectedComponent({ color: next }).catch(
        reportDiagramError,
      );
      break;
    }
    case "f": {
      const next = nextInCycle(
        FONT_CYCLE,
        comp.font as
          | "bold"
          | "italic"
          | "underline"
          | undefined,
      );
      void handleUpdateSelectedComponent({
        font: next,
      }).catch(reportDiagramError);
      break;
    }
  }
}

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
    /** Selected annotations' start positions (absolute), keyed by index, moved alongside nodes. */
    annotationStartPositions?: Record<number, { x: number; y: number }>;
    /** The annotation index grabbed to start an annotation-only drag (delta base). */
    annotationAnchor?: number;
  }
  | {
    // Resizing any node via any of its 8 edge/corner handles.
    type: "resizing";
    anchorIndex: number;
    handle: ResizeHandle;
    startBox: Box;
    startPointer: { x: number; y: number };
    groupBox: Box;
    startBoxes: Record<number, Box>;
    /** When set, this is an annotation resize: index into annotations + its start scale. */
    annotationResize?: { index: number; startScale: number };
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
    startSide?: ConnectionSide | undefined;
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
      e.isFile() &&
      e.name.endsWith(".hcl") &&
      !e.path.startsWith("diagrams/")
    );
    // Prefer the file that actually holds the system model, in priority
    // order. A bare "project.hcl" only carries project metadata, so it must
    // never shadow a real system file just because it sorts earlier.
    const preferred = ["system.hcl", "systems.hcl", "main.hcl", "project.hcl"]
      .map((name) => hclFiles.find((e) => e.name === name))
      .find(Boolean);
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
    const label = sourceKey.split("/").at(-1);
    const newKey = label ? `${targetParentKey}/${label}` : null;
    await fs.writeFile(targetPath, doc.systemHcl);
    sources = await readProjectSources(fs);
    if (newKey && selectedKeys.delete(sourceKey)) selectedKeys.add(newKey);
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
    const key = getComponentKey(idx);
    options.push({
      key,
      label: comp.label,
      isSystem: false,
      path: key,
    });
  });

  return options;
});

// The pool of reusable component definitions offered by "Use Existing
// Component". Derives directly from the top-level definitions in the compiled
// model (DocumentStore.definitions), so a definition is offered even with zero
// current instances. Sorted by label.
let reusableDefinitions = $derived.by(() => {
  return docStore.definitions.map((def) => ({
    sourceLabel: def.label,
    label: def.label,
    icon: def.icon || undefined,
  })).sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel));
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
      targetParent = getComponentKey(selIdx);
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
  const parentKey = getComponentKey(index);
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
  sourceLabel?: string;
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
    if (data.sourceLabel) {
      // Instances need a real container; fall back to the first system.
      if (doc.systems.length === 0) {
        doc.addSystem(parent || "main");
        parent = parent || "main";
      } else {
        parent = doc.systems[0]?.label ?? "main";
      }
    } else {
      // New reusable definitions have no system parent.
      parent = "";
    }
  }

  // New-definition mode: create a top-level reusable definition (no system
  // parent); it becomes available for instances from anywhere.
  if (!data.sourceLabel) {
    doc.addComponentDefinition(data.label, {
      leaf: data.leaf,
      description: data.description,
      tags: data.tags,
      ports: data.ports,
    });
  } else {
    // Reuse mode: create an `instance` of the chosen definition inside the
    // selected parent system/container.
    doc.addInstance(parent, data.label, data.sourceLabel);
  }

  await fs.writeFile(targetPath, doc.systemHcl);
  sources = await readProjectSources(fs);

  const fullKey = data.sourceLabel || parent
    ? `${parent}/${data.label}`
    : data.label;
  if (data.sourceLabel || parent) {
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
      selectOnly(newIndex);
    }
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
  const model = output.model();
  const doc = new DocumentStore();
  if (model) {
    doc.loadFromRawModel(model.to_js());
  } else if (sources.length > 0) {
    doc.loadFromSources(sources);
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
  selectedKeys.size === 1 ? selectedKeys.values().next().value ?? null : null,
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
    if (selectedKeys.delete(selectedKey)) selectedKeys.add(newKey);
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
    clearSelection();
  }
}

function onPortMouseDown(
  event: MouseEvent,
  compIndex: number,
  portLabel: string | null,
  worldPoint: { x: number; y: number },
  startSide?: ConnectionSide,
) {
  event.stopPropagation();
  event.preventDefault();
  interaction = {
    type: "connecting",
    sourceComponentIndex: compIndex,
    sourcePortLabel: portLabel,
    startSide,
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
    const key = getComponentKey(i);
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
  startSide?: ConnectionSide,
): Promise<void> {
  if (sourceCompIndex === targetCompIndex) return;

  const srcKey = getComponentKey(sourceCompIndex);
  const targetKey = getComponentKey(targetCompIndex);

  const srcParts = srcKey.split("/").filter(Boolean);
  const targetParts = targetKey.split("/").filter(Boolean);

  const srcCompLabel = srcParts[srcParts.length - 1];
  const targetCompLabel = targetParts[targetParts.length - 1];

  const lca = computeLcaConnection(
    srcKey,
    sourcePortLabel,
    targetKey,
    targetPortLabel,
  );

  if (!lca) {
    alert("Cannot connect components across different systems.");
    return;
  }

  const defaultConnLabel = `conn-${srcCompLabel}-${targetCompLabel}`;
  const connLabel = prompt("Connection name?", defaultConnLabel)?.trim();
  if (!connLabel) return;

  const { path: targetPath, content: mainContent } = await readMainContent();
  const doc = new DocumentStore();
  if (mainContent.trim()) {
    doc.loadFromHcl(mainContent);
  }

  const added = doc.addConnection(lca.lcaScopePath, {
    label: connLabel,
    from: lca.from,
    to: lca.to,
  });

  if (added) {
    recordUndoPoint();
    if (startSide) {
      savedConnections[connLabel] = { startSide };
    }
    await fs.writeFile(targetPath, doc.systemHcl);
    sources = await readProjectSources(fs);
  }
}

// Middle mouse button, or the left button while Space is held, always
// pans, regardless of what's under the cursor — including directly over a
// node, so it must be handled here too (not just in onCanvasMouseDown,
// which only sees clicks on empty canvas).
function onNodeMouseDown(event: MouseEvent, index: number) {
  selectedConnection = null;
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

  // Shift+click toggles the node in/out of the selection (multi-select).
  // A plain click on a node that isn't already part of the selection
  // replaces the selection with just that node; clicking a node that's
  // already selected (as part of a multi-selection) keeps the whole
  // selection, so dragging it moves the whole group.
  if (event.shiftKey) {
    if (selected.has(index)) {
      deselect(index);
    } else {
      select(index);
    }
  } else if (!selected.has(index)) {
    selectOnly(index);
  }

  const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
  const startPositions: Record<number, { x: number; y: number }> = {};
  for (const i of selected) {
    const box = checked[getComponentKey(i)];
    if (box) startPositions[i] = { x: box.x, y: box.y };
  }
  const anchorStart = startPositions[index] ?? { x: 0, y: 0 };
  interaction = {
    type: "dragging",
    anchorIndex: index,
    offsetX: svgCoords.x - anchorStart.x,
    offsetY: svgCoords.y - anchorStart.y,
    startPositions,
    annotationStartPositions: snapshotAnnotationPositions(),
  };
}

// Snapshot the currently selected annotations' positions for a group drag,
// keyed by annotation index (stable for the whole drag).
function snapshotAnnotationPositions(): Record<
  number,
  { x: number; y: number }
> {
  const map: Record<number, { x: number; y: number }> = {};
  for (const i of selectedAnnotations) {
    const a = annotations[i];
    if (a) map[i] = { x: a.x, y: a.y };
  }
  return map;
}

// Mouse down on an annotation label: select it and start dragging it (and
// any other selected annotations) with the same interaction as nodes.
function onAnnotationMouseDown(event: MouseEvent, index: number): void {
  event.stopPropagation();
  selectedConnection = null;
  if (autoLayoutRunning) return;
  if (event.button !== 0) return;
  event.preventDefault();
  recordUndoPoint();

  if (event.shiftKey) {
    if (selectedAnnotations.has(index)) {
      selectedAnnotations.delete(index);
    } else {
      selectedAnnotations.add(index);
    }
    selectedKeys.clear();
  } else if (!selectedAnnotations.has(index)) {
    selectAnnotation(index);
  }

  const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
  const anchor = annotations[index] ?? { x: 0, y: 0 };
  interaction = {
    type: "dragging",
    anchorIndex: -1, // no node anchor
    offsetX: svgCoords.x - anchor.x,
    offsetY: svgCoords.y - anchor.y,
    startPositions: {},
    // The dragged annotation's index (delta base) + the snapshot of the
    // whole annotation selection at drag start.
    annotationAnchor: index,
    annotationStartPositions: snapshotAnnotationPositions(),
  };
}

// Move every selected annotation by the same (deltaX, deltaY) from its own
// drag-start snapshot — recomputed from the snapshot each event (like
// applyGroupDelta), never accumulated, so there is no drift or flicker.
function applyAnnotationDelta(deltaX: number, deltaY: number): void {
  noteDiagramEdited();
  const current = interaction;
  if (current.type !== "dragging") return;
  const starts = current.annotationStartPositions;
  if (!starts) return;
  for (const idxStr of Object.keys(starts)) {
    const idx = Number(idxStr);
    const start = starts[idx];
    const a = annotations[idx];
    if (!a || !start) continue;
    annotations[idx] = {
      ...a,
      x: snap(start.x + deltaX),
      y: snap(start.y + deltaY),
    };
  }
}

// Start resizing a selected annotation from one of its corner handles.
// The drag changes the annotation's `scale` (100% = 1.0) — corner-pull
// distance scales the font multiplier, mirroring how node resize handles
// work but as a pure scale factor instead of a box.
function onAnnotationResizeMouseDown(
  event: MouseEvent,
  index: number,
  handle: ResizeHandle,
): void {
  event.stopPropagation();
  if (autoLayoutRunning) return;
  if (event.button !== 0) return;
  event.preventDefault();
  if (!selectedAnnotations.has(index)) selectAnnotation(index);
  recordUndoPoint();
  const a = annotations[index];
  if (!a) return;
  const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
  interaction = {
    type: "resizing",
    anchorIndex: -1,
    handle,
    startBox: { x: a.x, y: a.y, width: 0, height: 0 },
    startPointer: svgCoords,
    groupBox: { x: a.x, y: a.y, width: 0, height: 0 },
    startBoxes: {},
    annotationResize: { index, startScale: a.scale ?? 1 },
  };
}

function onCanvasMouseDown(event: MouseEvent) {
  selectedConnection = null;
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

// Starts a resize from any edge or corner handle of a node. Stops propagation
// so the handle's own mousedown doesn't also bubble up to the node's onmousedown.
function onResizeHandleMouseDown(
  event: MouseEvent,
  index: number,
  handle: ResizeHandle,
) {
  // See onNodeMouseDown's matching guard above.
  if (autoLayoutRunning) return;
  if (event.button !== 0) return;
  // Let a space-held click bubble up to the node's own mousedown handler,
  // which starts panning instead of a resize — keeps "how to start a pan"
  // in one place.
  if (isSpaceHeld()) return;
  event.preventDefault();
  event.stopPropagation();

  // If node is not already part of the selection, select only this node
  if (!selected.has(index)) selectOnly(index);

  // One undo point per resize gesture, recorded before anything resizes.
  recordUndoPoint();

  const startBoxes: Record<number, Box> = {};
  for (const i of selected) {
    const box = nodeBox(i);
    if (box) startBoxes[i] = box;
  }
  const groupBox = unionBox(Object.values(startBoxes));
  const startBox = nodeBox(index) ?? {
    x: 0,
    y: 0,
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
  };
  const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);

  interaction = {
    type: "resizing",
    anchorIndex: index,
    handle,
    startBox,
    startPointer: svgCoords,
    groupBox,
    startBoxes,
  };
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
  noteDiagramEdited();
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
        applyAnnotationDelta(deltaX, deltaY);

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
      } else if (
        current.anchorIndex === -1 && current.annotationStartPositions
      ) {
        // Annotation-only drag (no node anchor): compute the delta from the
        // grabbed anchor annotation's DRAG-START snapshot (like nodes do),
        // never from its live position, so each move is a clean delta off a
        // fixed base — no feedback, no runaway/flicker, cursor-accurate.
        const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
        const anchorStart = current.annotationStartPositions[
          current.annotationAnchor ?? -1
        ];
        if (anchorStart) {
          const deltaX = svgCoords.x - current.offsetX - anchorStart.x;
          const deltaY = svgCoords.y - current.offsetY - anchorStart.y;
          applyAnnotationDelta(deltaX, deltaY);
        }
      }
      return;
    }
    case "resizing": {
      if (current.annotationResize) {
        // Annotation resize: the corner drag maps (deltaX, deltaY) to a new
        // font scale — startScale + fractional distance. A minimum guard
        // keeps the note from collapsing to nothing.
        const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
        const deltaX = svgCoords.x - current.startPointer.x;
        const deltaY = svgCoords.y - current.startPointer.y;
        const a = annotations[current.annotationResize.index];
        if (a) {
          const start = current.annotationResize.startScale;
          const scale = Math.max(0.5, start + (deltaX + deltaY) / 100);
          annotations[current.annotationResize.index] = {
            ...a,
            scale,
          };
        }
        return;
      }
      const anchorStart = current.startBox;
      if (anchorStart) {
        const svgCoords = svgPoint(root_svg, event.clientX, event.clientY);
        const deltaX = svgCoords.x - current.startPointer.x;
        const deltaY = svgCoords.y - current.startPointer.y;

        if (selected.size <= 1) {
          const resizedBox = computeResizedBox(
            anchorStart,
            current.handle,
            deltaX,
            deltaY,
            MIN_NODE_SIZE,
          );
          const next: Box = {
            x: snap(resizedBox.x),
            y: snap(resizedBox.y),
            width: snap(resizedBox.width),
            height: snap(resizedBox.height),
          };
          writeClampedToActiveParent(current.anchorIndex, next);
        } else {
          const resizedBox = computeResizedBox(
            anchorStart,
            current.handle,
            deltaX,
            deltaY,
            MIN_NODE_SIZE,
          );
          const scaleX = resizedBox.width / anchorStart.width;
          const scaleY = resizedBox.height / anchorStart.height;
          applyGroupScale(current.startBoxes, current.groupBox, scaleX, scaleY);
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
        current.startSide,
      ).catch(reportDiagramError);
    }
  }
  if (current.type === "dragging") {
    if (reparentTargetIndex !== null) {
      const srcKey = getComponentKey(current.anchorIndex);
      const targetKey = getComponentKey(reparentTargetIndex);
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
    clearSelection();
    if (box && (box.width > 2 || box.height > 2)) {
      for (const index of marqueeCandidates) select(index);
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

let selectedConnection = $state<string | null>(null);

let selectedConnectionData = $derived.by(() => {
  if (!selectedConnection) return null;
  const conn = connections.find((c) => c.label === selectedConnection);
  if (!conn) return null;
  const fromKey = getComponentKey(conn.from);
  const toKey = getComponentKey(conn.to);
  const fromCompLabel = components[conn.from]?.label ?? fromKey;
  const toCompLabel = components[conn.to]?.label ?? toKey;
  return {
    label: conn.label,
    from: fromKey,
    to: toKey,
    fromCompLabel,
    toCompLabel,
    startSide: savedConnections[conn.label]?.startSide,
    endSide: savedConnections[conn.label]?.endSide,
  };
});

function setConnectionStartSide(side: ConnectionSide | undefined) {
  if (!selectedConnection) return;
  recordUndoPoint();
  const existing = savedConnections[selectedConnection] || {};
  if (side) {
    savedConnections[selectedConnection] = { ...existing, startSide: side };
  } else {
    const updated = { ...existing };
    delete updated.startSide;
    if (updated.endSide) {
      savedConnections[selectedConnection] = updated;
    } else {
      delete savedConnections[selectedConnection];
    }
  }
}

function setConnectionEndSide(side: ConnectionSide | undefined) {
  if (!selectedConnection) return;
  recordUndoPoint();
  const existing = savedConnections[selectedConnection] || {};
  if (side) {
    savedConnections[selectedConnection] = { ...existing, endSide: side };
  } else {
    const updated = { ...existing };
    delete updated.endSide;
    if (updated.startSide) {
      savedConnections[selectedConnection] = updated;
    } else {
      delete savedConnections[selectedConnection];
    }
  }
}

async function handleDeleteSelectedConnection(
  skipConfirm = false,
): Promise<void> {
  if (!selectedConnection) return;
  const label = selectedConnection;
  if (
    !skipConfirm &&
    !confirm(
      `Delete connection "${label}"? This will remove it from the system model.`,
    )
  ) {
    return;
  }
  const { path: targetPath, content: mainContent } = await readMainContent();
  const doc = new DocumentStore();
  if (mainContent.trim()) {
    doc.loadFromHcl(mainContent);
  }

  let foundScope: string | null = null;
  for (const sys of doc.systems) {
    if (sys.connections.some((c) => c.label === label)) {
      foundScope = sys.label;
      break;
    }
    const searchComps = (comps: ComponentData[], parentPath: string) => {
      for (const comp of comps) {
        const curPath = `${parentPath}/${comp.label}`;
        if (comp.connections.some((c) => c.label === label)) {
          foundScope = curPath;
          return;
        }
        searchComps(comp.components, curPath);
      }
    };
    searchComps(sys.components, sys.label);
    if (foundScope) break;
  }

  if (foundScope) {
    doc.deleteConnection(foundScope, label);
    await fs.writeFile(targetPath, doc.systemHcl);
    sources = await readProjectSources(fs);
  }

  delete savedConnections[label];
  selectedConnection = null;
}

// Only connections where both endpoints are currently on the canvas.
let visibleConnections = $derived(
  computeVisibleConnections(
    connections.map((conn) => {
      const entry: {
        from: number;
        to: number;
        label: string;
        startSide?: ConnectionSide;
        endSide?: ConnectionSide;
      } = { from: conn.from, to: conn.to, label: conn.label };
      const saved = savedConnections[conn.label];
      if (saved?.startSide !== undefined) entry.startSide = saved.startSide;
      if (saved?.endSide !== undefined) entry.endSide = saved.endSide;
      return entry;
    }),
    (i) => nodeBox(i),
  ),
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
  computeRenderOrder(
    Object.keys(checked)
      .map((key) => keyToIndex.get(key))
      .filter((index): index is number => index !== undefined),
    parentOf,
  ),
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
    case "idle":
      return null;
    case "dragging":
      return "Dragging";
    case "connecting":
      return "Connecting";
    case "resizing":
      return "Resizing";
    case "panning":
      return "Panning";
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
    {:else if selectedConnectionData}
      <div class="space-y-4 text-sm" data-testid="connection-inspector">
        <div>
          <div class="text-[11px] text-base-content/50 font-mono uppercase">Connection</div>
          <h4 class="text-base font-bold text-base-content truncate">{selectedConnectionData.label}</h4>
        </div>

        <div class="space-y-2 bg-base-200 p-2.5 rounded-box border border-base-300 text-xs font-mono">
          <div class="flex items-center justify-between">
            <span class="text-base-content/60">From:</span>
            <span class="font-semibold truncate max-w-[150px]">{selectedConnectionData.from}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-base-content/60">To:</span>
            <span class="font-semibold truncate max-w-[150px]">{selectedConnectionData.to}</span>
          </div>
        </div>

        <div class="space-y-1.5 pt-1">
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
            {selectedConnectionData.fromCompLabel} starting point
          </span>
          <div class="grid grid-cols-5 gap-1 w-full">
            <button
              class="btn btn-xs {selectedConnectionData.startSide === undefined ? 'btn-primary' : 'btn-ghost border border-base-300'}"
              onclick={() => setConnectionStartSide(undefined)}
            >
              Auto
            </button>
            <button
              class="btn btn-xs {selectedConnectionData.startSide === 'top' ? 'btn-primary' : 'btn-ghost border border-base-300'}"
              onclick={() => setConnectionStartSide('top')}
            >
              Top
            </button>
            <button
              class="btn btn-xs {selectedConnectionData.startSide === 'right' ? 'btn-primary' : 'btn-ghost border border-base-300'}"
              onclick={() => setConnectionStartSide('right')}
            >
              Right
            </button>
            <button
              class="btn btn-xs {selectedConnectionData.startSide === 'bottom' ? 'btn-primary' : 'btn-ghost border border-base-300'}"
              onclick={() => setConnectionStartSide('bottom')}
            >
              Bottom
            </button>
            <button
              class="btn btn-xs {selectedConnectionData.startSide === 'left' ? 'btn-primary' : 'btn-ghost border border-base-300'}"
              onclick={() => setConnectionStartSide('left')}
            >
              Left
            </button>
          </div>
        </div>

        <div class="space-y-1.5 pt-1">
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
            {selectedConnectionData.toCompLabel} starting point
          </span>
          <div class="grid grid-cols-5 gap-1 w-full">
            <button
              class="btn btn-xs {selectedConnectionData.endSide === undefined ? 'btn-primary' : 'btn-ghost border border-base-300'}"
              onclick={() => setConnectionEndSide(undefined)}
            >
              Auto
            </button>
            <button
              class="btn btn-xs {selectedConnectionData.endSide === 'top' ? 'btn-primary' : 'btn-ghost border border-base-300'}"
              onclick={() => setConnectionEndSide('top')}
            >
              Top
            </button>
            <button
              class="btn btn-xs {selectedConnectionData.endSide === 'right' ? 'btn-primary' : 'btn-ghost border border-base-300'}"
              onclick={() => setConnectionEndSide('right')}
            >
              Right
            </button>
            <button
              class="btn btn-xs {selectedConnectionData.endSide === 'bottom' ? 'btn-primary' : 'btn-ghost border border-base-300'}"
              onclick={() => setConnectionEndSide('bottom')}
            >
              Bottom
            </button>
            <button
              class="btn btn-xs {selectedConnectionData.endSide === 'left' ? 'btn-primary' : 'btn-ghost border border-base-300'}"
              onclick={() => setConnectionEndSide('left')}
            >
              Left
            </button>
          </div>
        </div>

        <div class="divider my-2"></div>
        <button
          class="btn btn-xs btn-outline btn-error w-full"
          onclick={() => void handleDeleteSelectedConnection().catch(reportDiagramError)}
        >
          Delete connection
        </button>
      </div>
    {:else}
      <p class="text-base-content/50 text-sm">
        Select a component or connection on the canvas to edit its properties.
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
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <svg
        bind:this={root_svg}
        version="1.1"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="{editor_state.view.x} {editor_state.view
                    .y} {canvas_width / editor_state.view.zoom} {canvas_height /
                    editor_state.view.zoom}"
        tabindex="0"
        onfocus={() => (canvasFocused = true)}
        onblur={() => (canvasFocused = false)}
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
            World-space graduated grid: patternUnits="userSpaceOnUse" ties
            each tile to the same coordinate system as nodes/connections, so
            it pans and zooms for free via the SVG's own viewBox transform —
            no JS math needed. The patterns form a chain (finest → coarsest,
            see grid.ts): each coarser tile is filled with the next-finest
            pattern and draws its own bolder edge lines on top, so lines at
            every graduation level (10/100/1000 units) stay aligned to world
            coordinates and tile seamlessly.
          -->
          {#each gridPatterns as pattern (pattern.id)}
            <pattern
              id={pattern.id}
              width={pattern.size}
              height={pattern.size}
              patternUnits="userSpaceOnUse"
            >
              {#if pattern.fill}
                <!-- Tile filled with the next-finest level, aligned to the
                     same world-space origin, so lines at every level line up. -->
                <rect
                  x="0"
                  y="0"
                  width={pattern.size}
                  height={pattern.size}
                  fill="url(#{pattern.fill})"
                />
              {/if}
              <!-- This level's own edge lines (right + bottom of the tile),
                   drawn on top of the finer fill; each tile's edges meet the
                   next tile's edges seamlessly. -->
              <line
                x1={pattern.size}
                y1="0"
                x2={pattern.size}
                y2={pattern.size}
                stroke={pattern.stroke ?? "var(--color-base-content)"}
                stroke-opacity={pattern.strokeOpacity}
                stroke-width={pattern.strokeWidth}
              />
              <line
                x1="0"
                y1={pattern.size}
                x2={pattern.size}
                y2={pattern.size}
                stroke={pattern.stroke ?? "var(--color-base-content)"}
                stroke-opacity={pattern.strokeOpacity}
                stroke-width={pattern.strokeWidth}
              />
            </pattern>
          {/each}
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
          <marker
            id="arrow-selected"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              fill="var(--color-primary)"
            />
          </marker>
        </defs>
        <rect
          fill={gridVisible ? `url(#${gridFillId})` : "transparent"}
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
          {@const compKey = getComponentKey(index)}
          {@const compData = docStore.findComponent(compKey)}
          {@const icon = resolveIcon(compData?.icon ?? components[index]?.icon)}
          {@const borderSvg = borderStyleToSvg({
            color: compData?.color || components[index]?.color,
            border: compData?.border ?? components[index]?.border,
          })}
          {@const fontSvg = fontStyleToSvg(compData?.font ?? components[index]?.font)}
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
              stroke={borderSvg.stroke ?? "var(--color-base-content)"}
              stroke-width="1"
              stroke-dasharray={borderSvg.dasharray}
              fill="var(--color-base-200)"
            />
            {#if highlighted}
              <!-- Selection indicator: a 50%-transparent dotted outline drawn
                   on top of the node's own border, so the component's style
                   (color / border) stays visible and isn't obscured. -->
              {@const outline = selectionOutlineRect(width, height)}
              <rect
                x={outline.x}
                y={outline.y}
                width={outline.width}
                height={outline.height}
                rx="5"
                fill="none"
                stroke="var(--color-primary)"
                stroke-opacity={SELECTION_OUTLINE_OPACITY}
                stroke-width="1.5"
                stroke-dasharray={SELECTION_OUTLINE_DASHARRAY}
                style="pointer-events: none"
              />
            {/if}
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
            {#if icon}
              {#if textAlign === "top-left"}
                <svg
                  x={8}
                  y={8}
                  width="14"
                  height="14"
                  viewBox="0 0 {icon.width} {icon.height}"
                  fill="var(--color-base-content)"
                  opacity="0.85"
                >
                  <path d={icon.svgPath} />
                </svg>
                <text
                  x={26}
                  y={textPos.y}
                  fill="var(--color-base-content)"
                  text-anchor="start"
                  dominant-baseline={textPos.baseline}
                  font-weight={fontSvg.fontWeight}
                  font-style={fontSvg.fontStyle}
                  text-decoration={fontSvg.textDecoration}
                  style="pointer-events: none; user-select: none"
                >
                  {label}
                </text>
              {:else if textAlign === "top-center"}
                {@const estimatedWidth = Math.min(width - 16, label.length * 7.5 + 18)}
                {@const startX = Math.max(8, (width - estimatedWidth) / 2)}
                <svg
                  x={startX}
                  y={8}
                  width="14"
                  height="14"
                  viewBox="0 0 {icon.width} {icon.height}"
                  fill="var(--color-base-content)"
                  opacity="0.85"
                >
                  <path d={icon.svgPath} />
                </svg>
                <text
                  x={startX + 18}
                  y={textPos.y}
                  fill="var(--color-base-content)"
                  text-anchor="start"
                  dominant-baseline={textPos.baseline}
                  font-weight={fontSvg.fontWeight}
                  font-style={fontSvg.fontStyle}
                  text-decoration={fontSvg.textDecoration}
                  style="pointer-events: none; user-select: none"
                >
                  {label}
                </text>
              {:else}
                <svg
                  x={width / 2 - 9}
                  y={height / 2 - 20}
                  width="18"
                  height="18"
                  viewBox="0 0 {icon.width} {icon.height}"
                  fill="var(--color-base-content)"
                  opacity="0.85"
                >
                  <path d={icon.svgPath} />
                </svg>
                <text
                  x={width / 2}
                  y={height / 2 + 10}
                  fill="var(--color-base-content)"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  font-weight={fontSvg.fontWeight}
                  font-style={fontSvg.fontStyle}
                  text-decoration={fontSvg.textDecoration}
                  style="pointer-events: none; user-select: none"
                >
                  {label}
                </text>
              {/if}
            {:else}
              <text
                x={textPos.x}
                y={textPos.y}
                fill="var(--color-base-content)"
                text-anchor={textPos.anchor}
                dominant-baseline={textPos.baseline}
                font-weight={fontSvg.fontWeight}
                font-style={fontSvg.fontStyle}
                text-decoration={fontSvg.textDecoration}
                style="pointer-events: none; user-select: none"
              >
                {label}
              </text>
            {/if}

            <!-- 4 Edge resize hit strips (transparent, active on hover) -->
            <!-- Top edge -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect
              x={CORNER_HANDLE_SIZE}
              y={-EDGE_HANDLE_THICKNESS / 2}
              width={Math.max(1, width - 2 * CORNER_HANDLE_SIZE)}
              height={EDGE_HANDLE_THICKNESS}
              fill="transparent"
              style="cursor: {autoLayoutRunning ? 'wait' : 'ns-resize'}"
              onmousedown={(e) => onResizeHandleMouseDown(e, index, "top")}
            />
            <!-- Bottom edge -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect
              x={CORNER_HANDLE_SIZE}
              y={height - EDGE_HANDLE_THICKNESS / 2}
              width={Math.max(1, width - 2 * CORNER_HANDLE_SIZE)}
              height={EDGE_HANDLE_THICKNESS}
              fill="transparent"
              style="cursor: {autoLayoutRunning ? 'wait' : 'ns-resize'}"
              onmousedown={(e) => onResizeHandleMouseDown(e, index, "bottom")}
            />
            <!-- Left edge -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect
              x={-EDGE_HANDLE_THICKNESS / 2}
              y={CORNER_HANDLE_SIZE}
              width={EDGE_HANDLE_THICKNESS}
              height={Math.max(1, height - 2 * CORNER_HANDLE_SIZE)}
              fill="transparent"
              style="cursor: {autoLayoutRunning ? 'wait' : 'ew-resize'}"
              onmousedown={(e) => onResizeHandleMouseDown(e, index, "left")}
            />
            <!-- Right edge -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect
              x={width - EDGE_HANDLE_THICKNESS / 2}
              y={CORNER_HANDLE_SIZE}
              width={EDGE_HANDLE_THICKNESS}
              height={Math.max(1, height - 2 * CORNER_HANDLE_SIZE)}
              fill="transparent"
              style="cursor: {autoLayoutRunning ? 'wait' : 'ew-resize'}"
              onmousedown={(e) => onResizeHandleMouseDown(e, index, "right")}
            />

            <!-- 4 Corner resize handles -->
            <!-- Top-Left corner -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect
              x={-CORNER_HANDLE_SIZE / 2}
              y={-CORNER_HANDLE_SIZE / 2}
              width={CORNER_HANDLE_SIZE}
              height={CORNER_HANDLE_SIZE}
              fill="transparent"
              style="cursor: {autoLayoutRunning ? 'wait' : 'nwse-resize'}"
              onmousedown={(e) => onResizeHandleMouseDown(e, index, "top-left")}
            />
            <!-- Top-Right corner -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect
              x={width - CORNER_HANDLE_SIZE / 2}
              y={-CORNER_HANDLE_SIZE / 2}
              width={CORNER_HANDLE_SIZE}
              height={CORNER_HANDLE_SIZE}
              fill="transparent"
              style="cursor: {autoLayoutRunning ? 'wait' : 'nesw-resize'}"
              onmousedown={(e) => onResizeHandleMouseDown(e, index, "top-right")}
            />
            <!-- Bottom-Left corner -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect
              x={-CORNER_HANDLE_SIZE / 2}
              y={height - CORNER_HANDLE_SIZE / 2}
              width={CORNER_HANDLE_SIZE}
              height={CORNER_HANDLE_SIZE}
              fill="transparent"
              style="cursor: {autoLayoutRunning ? 'wait' : 'nesw-resize'}"
              onmousedown={(e) => onResizeHandleMouseDown(e, index, "bottom-left")}
            />
            <!-- Bottom-Right corner -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect
              x={width - CORNER_HANDLE_SIZE / 2}
              y={height - CORNER_HANDLE_SIZE / 2}
              width={CORNER_HANDLE_SIZE}
              height={CORNER_HANDLE_SIZE}
              fill="transparent"
              style="cursor: {autoLayoutRunning ? 'wait' : 'nwse-resize'}"
              onmousedown={(e) => onResizeHandleMouseDown(e, index, "bottom-right")}
            />

            <!-- Port & Directional handles (visible when selected or actively dragging a connection) -->
            {#if selected.has(index) || interaction.type === "connecting"}
              <!-- 4 Directional handles for starting connection from any border side -->
              {#each computeDirectionalHandles(width, height) as handle (handle.side)}
                <g transform="translate({handle.x}, {handle.y})">
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle
                    r="8"
                    fill="transparent"
                    class="cursor-crosshair"
                    onmousedown={(e) =>
                      onPortMouseDown(e, index, null, {
                        x: x + handle.x,
                        y: y + handle.y,
                      }, handle.side)}
                  >
                    <title>Drag connection from {handle.side}</title>
                  </circle>
                  <circle
                    r="3.5"
                    fill="var(--color-primary)"
                    fill-opacity="0.85"
                    stroke="var(--color-base-100)"
                    stroke-width="1"
                    style="pointer-events: none"
                  />
                </g>
              {/each}

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
              {/if}
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
          {@const isConnSelected = selectedConnection === conn.label}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <g
            class="cursor-pointer"
            onclick={(e) => {
              e.stopPropagation();
              selectedConnection = conn.label;
              clearSelection();
            }}
          >
            <!-- Thicker invisible hit target -->
            <path
              d={elbowPath(a.x, a.y, b.x, b.y, orientation)}
              stroke="transparent"
              stroke-width="14"
              fill="none"
            />
            <path
              d={elbowPath(a.x, a.y, b.x, b.y, orientation)}
              stroke={isConnSelected
                ? "var(--color-primary)"
                : "var(--color-base-content)"}
              stroke-opacity={isConnSelected ? 1 : 0.35}
              stroke-width={isConnSelected ? 2.5 : 1.5}
              fill="none"
              marker-end="url(#{isConnSelected ? 'arrow-selected' : 'arrow'})"
            />
            <text
              x={(a.x + b.x) / 2}
              y={(a.y + b.y) / 2 - 6}
              fill={isConnSelected
                ? "var(--color-primary)"
                : "var(--color-base-content)"}
              fill-opacity={isConnSelected ? 1 : 0.5}
              font-size="10"
              font-weight={isConnSelected ? "bold" : "normal"}
              text-anchor="middle"
              style="user-select: none"
            >
              {conn.label}
            </text>
          </g>
        {/each}

        <!-- Free-standing text annotations, rendered at absolute positions.
             Selectable + draggable like nodes; double-click to edit text;
             corner-drag to resize (changes the font scale). The text itself
             is pointer-events: none; an invisible rect behind it is the hit
             target (SVG <g> has no geometry of its own). -->
        {#each annotations as ann, i (`${i}-${ann.text}-${ann.x}-${ann.y}-${ann.scale}`)}
          {@const isAnnSelected = selectedAnnotations.has(i)}
          {@const annFontSize = 12 * (ann.scale ?? 1)}
          {@const annLines = ann.text.split("\n")}
          {@const annWidth = Math.max(...annLines.map((l) => l.length * 7.5 * (ann.scale ?? 1) + 14), 40)}
          {@const annHeight = annLines.length * 16 * (ann.scale ?? 1) + 8}
          {@const annX = ann.x - 4}
          {@const annY = ann.y - 16 * (ann.scale ?? 1)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <g
            class="cursor-grab"
            onmousedown={(e) => onAnnotationMouseDown(e, i)}
            ondblclick={(e) => {
              e.stopPropagation();
              selectAnnotation(i);
              editingAnnotation = i;
            }}
          >
            <rect
              x={annX}
              y={annY}
              width={annWidth}
              height={annHeight}
              fill="transparent"
              style="cursor: grab"
            />
            {#if isAnnSelected}
              <!-- Selection frame identical in style to components: a dotted
                   primary outline around the annotation's hit box. -->
              <rect
                x={annX}
                y={annY}
                width={annWidth}
                height={annHeight}
                rx="3"
                fill="none"
                stroke="var(--color-primary)"
                stroke-opacity={SELECTION_OUTLINE_OPACITY}
                stroke-width="1.5"
                stroke-dasharray={SELECTION_OUTLINE_DASHARRAY}
                style="pointer-events: none"
              />
              <!-- Top-right corner resize handle (font scale), tucked INSIDE
                   the selection box (x/y within annX..annX+annWidth). -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <rect
                x={annX + annWidth - CORNER_HANDLE_SIZE}
                y={annY}
                width={CORNER_HANDLE_SIZE}
                height={CORNER_HANDLE_SIZE}
                fill="var(--color-primary)"
                fill-opacity="0.9"
                style="cursor: nesw-resize"
                onmousedown={(e) => onAnnotationResizeMouseDown(e, i, "top-right")}
              />
            {/if}
            {#if editingAnnotation === i}
              <text
                x={ann.x}
                y={ann.y}
                fill="var(--color-primary)"
                font-size={annFontSize}
                text-anchor="start"
                style="user-select: none"
              >
                {ann.text}
              </text>
            {:else}
              <text
                x={ann.x}
                y={ann.y}
                fill={isAnnSelected
                  ? "var(--color-primary)"
                  : "var(--color-base-content)"}
                font-size={annFontSize}
                text-anchor="start"
                style="pointer-events: none; user-select: none; white-space: pre"
              >
                {ann.text}
              </text>
            {/if}
          </g>
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

      {#if editingAnnotationObj}
        <!-- Inline text editor for the annotation being edited. Positioned in
             screen space (world coords x zoom + view origin). -->
        <input
          bind:value={editingAnnotationObj.text}
          onkeydown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              noteDiagramEdited();
              editingAnnotation = null;
            }
            if (e.key === "Escape") {
              editingAnnotation = null;
            }
          }}
          onblur={() => {
            noteDiagramEdited();
            editingAnnotation = null;
          }}
          class="absolute z-30 input input-sm input-bordered w-64"
          style="left:{(editingAnnotationObj.x - editor_state.view.x) * editor_state.view.zoom}px; top:{(editingAnnotationObj.y - editor_state.view.y) * editor_state.view.zoom}px"
          data-testid="annotation-editor"
        />
      {/if}

      {#if !model && output.error_count() > 0}
        <div
          class="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
        >
          <div
            class="card bg-base-100/95 border border-error/50 shadow-2xl p-6 text-center max-w-xl pointer-events-auto backdrop-blur-xs"
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
                class="bg-base-200 p-2.5 rounded text-xs font-mono text-left text-error/90 mb-4 border border-error/20 break-words whitespace-normal"
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
        onaddannotation={() => addAnnotationHandler()}
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

  <!-- Right sidebar: component list and embed action -->
  <aside
    class="w-64 shrink-0 bg-base-100 text-base-content p-4 overflow-y-auto border-l border-base-300 flex flex-col justify-between gap-4"
  >
    <div class="flex flex-col flex-1 min-h-0 overflow-y-auto">
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
        <ComponentHierarchyTree
          {systems}
          {components}
          {selected}
          isChecked={(index) => checkedIndices.has(index)}
          onToggleChecked={(index) => toggleComponentChecked(index)}
        />
      {/if}

        <div class="divider"></div>

      <h3
        class="font-semibold text-sm mb-3 text-base-content/70 uppercase tracking-wide"
      >
        Definitions
      </h3>

      {#if reusableDefinitions.length === 0}
        <p class="text-xs text-base-content/50 italic">
          No reusable definitions yet — create one with "New Component
          Definition".
        </p>
      {:else}
        <ul class="space-y-1">
          {#each reusableDefinitions as def (def.sourceLabel)}
            <li
              class="flex items-center gap-2 text-sm truncate font-mono"
              title={def.label}
            >
              <span class="truncate">{def.label}</span>
            </li>
          {/each}
        </ul>
      {/if}

        <div class="divider"></div>

      <h3
        class="font-semibold text-sm mb-3 text-base-content/70 uppercase tracking-wide"
      >
        Connections
      </h3>

      <ul class="space-y-1">
        {#each connections as connection (`${connection.label}-${connection.from}-${connection.to}`)}
          <li class="flex items-center gap-2 text-sm truncate" title={connection.label}>
            {connection.label}
          </li>
        {/each}
      </ul>
    </div>

    <!-- Embed Diagram + Copy Debug Info buttons -->
    <div class="pt-3 border-t border-base-300 shrink-0 space-y-2">
      <button
        type="button"
        class="btn btn-outline btn-sm w-full flex items-center justify-center gap-1.5 {copiedDebug ? 'btn-success' : ''}"
        onclick={() => void handleCopyDebug().catch(reportDiagramError)}
        title="Copy the session's model mutations as a replayable TypeScript test"
      >
        <span aria-hidden="true">🚧</span>
        <span>{copiedDebug ? '✓ Copied' : 'Copy Debug Info'}</span>
      </button>
      <EmbedDiagramButton
        projectId={data.projectId}
        diagramPath={selectedDiagramPath}
      />
    </div>
  </aside>
</div>

<CreateComponentModal
  isOpen={isCreateModalOpen}
  {availableParents}
  {reusableDefinitions}
  defaultParentKey={createModalDefaultParent}
  initialPosition={createModalPosition}
  oncreate={(data) => void handleModalCreateComponent(data).catch(reportDiagramError)}
  onclose={() => (isCreateModalOpen = false)}
/>
