# Finished Tasks

Completed tasks are listed here, most recent first.

---

## Task 56 — `ProjectStore` interface + localStorage-backed implementation

Second of the five-task VFS sequence (55–59). Introduces the actual
storage engine behind a storage-agnostic interface, with zero new
dependencies — the entire VFS lives in one JSON blob under one
`localStorage` key, matching the existing `Persisted.svelte.ts` pattern.
Still local-first/single-editor; no locking, no CRDT.

- Added `web/src/vfs/operations.ts`: pure, synchronous functions
  (`listProjects`, `createProject`, `deleteProject`, `listNodes`,
  `createFile`, `createDirectory`, `updateFileContent`, `renameNode`,
  `moveNode`, `deleteNode`) operating on a `VfsData` snapshot
  (`{ version: 1, projects: Project[], nodes: FsNode[] }`). Each either
  returns a new `VfsData` (never mutating its input) or throws —
  validation (unknown project/node ids, parent-must-be-a-directory,
  parent-must-belong-to-the-same-project, `wouldCreateCycle` before a
  move), cascading deletes (via `descendantsOf`, from Task 55's
  `tree.ts`), and "touch the owning project's `updatedAt`" bookkeeping all
  live here exactly once, shared by every store implementation instead of
  being reimplemented per backend.
- Added `web/src/vfs/store.ts`: the `ProjectStore` interface (`listProjects`,
  `createProject`, `deleteProject`, `listNodes`, `createFile`,
  `createDirectory`, `updateFileContent`, `renameNode`, `moveNode`,
  `deleteNode`), documented with its rejection rules. Every method returns
  a `Promise` even though both current implementations are fully
  synchronous — kept deliberately so a future network- or sync-queue-backed
  implementation is a drop-in replacement with no call-site changes.
- Added `web/src/vfs/inMemoryStore.ts`: `InMemoryProjectStore`, a thin
  `ProjectStore` wrapper holding one in-memory `VfsData` and delegating
  every method to `operations.ts`. No storage dependency — the default
  fast test double.
- Added `web/src/vfs/localStorageStore.ts`: `LocalStorageProjectStore`,
  a thin `ProjectStore` wrapper that on every call reads the single
  `"rhizz:vfs:v1"` localStorage key, `JSON.parse`s + validates it with
  zod (dropping individually-malformed projects/nodes rather than
  discarding the whole blob — same forgiving-parse philosophy as
  `sanitizeStoredRecord` in `diagrams/persistence.ts`), delegates the
  mutation to `operations.ts`, then `JSON.stringify`s and writes the
  result back. Constructor takes an optional `StorageLike` (`{ getItem,
  setItem }` — the minimal subset actually needed, deliberately not the
  full DOM `Storage` interface's `removeItem`/`clear`/`length`/`key`),
  defaulting to `globalThis.localStorage`, plus an optional clock
  function — both purely to keep the class unit-testable without a DOM
  environment (this project's Vitest setup has no jsdom/happy-dom — see
  Task 36's notes).
- Added `web/src/vfs/store.contract.test.ts`: exports
  `runProjectStoreContractTests(label, makeStore)` (23 `it`s across
  project CRUD, file/directory CRUD, rename, move — including the
  self-move and descendant-move cycle-rejection cases — recursive delete,
  and revision/updatedAt bookkeeping) and calls it once for
  `InMemoryProjectStore` and once for `LocalStorageProjectStore` (backed by
  a plain `Map`-based fake storage, plus a deterministic incrementing
  clock so timestamp assertions can't flake on real wall-clock
  resolution) — 46 tests total, both implementations verified against the
  exact same rules.
- No UI changes. No new dependencies — only `zod` (already present) plus
  `localStorage`/`JSON`/`crypto.randomUUID()`, all browser built-ins.
- Validated with `deno task --cwd web test` (156/156 pass, 46 new),
  `deno task --cwd web check` (`svelte-check`: 0 errors/warnings),
  `deno task --cwd web build` (succeeds), and `deno fmt --check web`
  (clean). Commands run via `nix develop --command deno ...` per the
  user's environment, using `deno task --cwd <dir>` (this sandbox's
  `deno` doesn't support the `-C` shorthand).

## Task 55 — VFS domain types & pure tree helpers

First of a five-task sequence (55–59) building a virtual filesystem
hierarchy for the frontend, to support multiple multi-file projects &
diagrams stored locally in the browser. Explicitly local-first,
single-editor — no real-time collaboration/CRDT; a future file-locking
mechanism is left as a possible follow-up once there's a backend, not
designed for here.

- Added `web/src/vfs/types.ts`: zod schemas + inferred types for the VFS
  domain — `FsFileContentTypeSchema` (`"hcl" | "diagram-layout"`),
  `FsDirectorySchema`, `FsFileSchema`, `FsNodeSchema` (a
  `z.discriminatedUnion("kind", ...)` of the two), and `ProjectSchema`.
  IDs (`id`/`projectId`/`parentId`) are plain strings, intended to be
  client-generated UUIDs (`crypto.randomUUID()`) — never names/paths —
  so a future backend can accept client-created records without an
  ID-remapping step. `FsFile` carries `revision`/`updatedAt` so even a
  naive last-write-wins sync strategy has something to compare later.
  Added `isFile`/`isDirectory` type guards for narrowing `FsNode` in
  `.filter(...)` chains.
- Added `web/src/vfs/tree.ts`: pure functions operating on flat `FsNode[]`
  lists, with zero Svelte/DOM/storage dependency —
  - `buildTree(nodes)` — flat list to nested `TreeNode[]` for sidebar
    rendering; treats a node as a root if `parentId` is `null` *or*
    points outside the given list, so it works whether called with every
    node in the store or a pre-filtered per-project slice.
  - `pathOf(nodeId, nodes)` — `"/"`-joined ancestor path (e.g.
    `"components/imu.hcl"`); throws on an unknown id or a detected cycle.
  - `descendantsOf(nodeId, nodes)` — breadth-first list of all
    descendants, for recursive directory delete.
  - `wouldCreateCycle(nodeId, newParentId, nodes)` — guard intended for a
    future `ProjectStore.moveNode` (Task 56); `null` target is never a
    cycle, moving under self or under a descendant is.
  - `projectSources(nodes)` — filters `contentType: "hcl"` files and maps
    them to `{ filename: pathOf(node), content }`, the exact `Source[]`
    shape `rhizz_wasm_wrapper.ts`'s `compile_system` already accepts, so
    diagnostics can eventually point at real per-file paths instead of
    the current hardcoded `"all.hcl"`.
- Added `web/src/vfs/types.test.ts` (14 tests) and `web/src/vfs/tree.test.ts`
  (18 tests) covering schema acceptance/rejection (including the
  discriminated union and the type guards) and each tree helper's edge
  cases (empty input, cycles, grandchildren, unrelated-node moves).
- No storage engine, no UI changes — that's Task 56 onward.
- No new dependencies (only `zod`, already present).
- Validated with `deno task --cwd web test` (110/110 pass, 32 new),
  `deno task --cwd web check` (`svelte-check`: 0 errors/warnings),
  `deno task --cwd web build` (succeeds), and `deno fmt --check web`
  (clean). Commands were run via `nix develop --command deno ...` in this
  environment, using `deno task --cwd <dir>` since this sandbox's `deno`
  didn't support the `-C` shorthand.

## Task 54 — Display current editing state as a bottom-right hint

- `web/src/routes/diagrams/+page.svelte` gained a `currentActivity`
  `$derived.by`, resolving the two overlapping state sources into one
  label: `autoLayoutRunning` first ("Calculating…"), then
  `interaction.type` (`"Resizing"`, `"Panning"`, `"Selecting"` for
  marquee). Deliberately excludes `"dragging"` (per explicit feedback —
  already visually obvious from the node moving under the cursor, a text
  label would just be noise) and `"idle"` (nothing to announce).
- Fade timing needed its own small state machine, not just a CSS
  transition bound straight to a derived value: an `$effect` watches
  `currentActivity` and, on entering a new activity, immediately sets
  `activityHintLabel`/`activityHintVisible = true`; on returning to
  idle/dragging, schedules a `setTimeout` (after `ACTIVITY_HINT_
  SUSTAIN_MS`) that hides it. If a new activity starts before that
  timeout fires, Svelte's automatic effect-cleanup (the function returned
  from the effect) clears the pending timeout before the effect re-runs
  — so quick back-to-back activities never visibly flicker out and back
  in.
- `ACTIVITY_HINT_FADE_IN_MS` (100), `ACTIVITY_HINT_SUSTAIN_MS` (500), and
  `ACTIVITY_HINT_FADE_OUT_MS` (400) are extracted as top-level constants
  per request, so they can be tweaked without touching markup. The
  template interpolates whichever duration applies directly into an
  inline `transition-duration` style (rather than baking fixed Tailwind
  `duration-*` classes into markup), so the constants are the single
  source of truth for both the JS timing and the CSS animation.
- Positioned `absolute bottom-2 right-2` inside the same canvas-relative
  container as the bottom-center toolbar (that toolbar moved to
  bottom-*center* a few tasks ago, so bottom-right was free); `pointer-
  events-none` so it can never intercept clicks.
- No automated test coverage — this is UI/timing behavior tightly coupled
  to Svelte's `$effect`/`setTimeout`, unlike the project's pure-function
  Vitest-covered modules (`geometry.ts`/`forceLayout.ts`/`history.ts`).
  Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), `deno task test` (78/78 pass, unaffected), and `deno fmt`
  (clean); the animation itself needs manual/browser verification.

---

## Task 50 — Automatic layout via force simulation

Implemented an "Auto Layout" button on the diagrams page's bottom
toolbar: force-arranges the current selection, or every currently-placed
node (any level) if nothing's selected. One remaining concrete piece of
the original scope (pinning pre-existing nodes so only newly-added ones
get laid out) was split out as Task 53; the vaguer "exploring the system
model interactively" use-case was deliberately left untracked, since
there's still no concrete trigger to hang it off of.

- `web/src/routes/diagrams/forceLayout.ts`: pure, Svelte/`rhizz-core`-free
  wrapper around `d3-force` (+ `@types/d3-force`). Exposes
  `createForceLayout` (a `{ tick(), alpha() }` pair for frame-by-frame
  driving), `runForceLayout` (synchronous convergence, used by tests),
  and `groupBySiblings` (partitions nodes by immediate parent). Nodes are
  approximated as circles (`Math.hypot(width, height) / 2`) for the
  collision force; a node's own diagram index round-trips via a
  `componentIndex` field, not `index` (which d3-force reserves for its
  own bookkeeping and silently overwrites). Supports pinning a node via
  `fixed: true` (sets d3-force's `fx`/`fy` — not yet wired to any UI, see
  Task 53). A custom `forceOrthogonalAlign` force biases connected pairs
  toward strictly horizontal/vertical alignment rather than arbitrary
  diagonals. A `warmupTicks` option eases the animation in over the first
  N ticks (verified to never change the eventual converged result). 31
  Vitest tests across `forceLayout.test.ts`.
- The target set is partitioned into sibling groups (`groupBySiblings`,
  keyed by parent) and each group gets its own independent simulation,
  centered on its parent's current box (or its own bounding box for
  top-level/orphaned groups) — avoiding a flat simulation that would let
  unrelated hierarchy levels interfere with each other. All groups run
  together via one shared `requestAnimationFrame` loop; every result is
  still written through `writeClampedToActiveParent` (Tasks 45/46's
  containment path) regardless of grouping, as a safety net. Only the
  final settling frame is snapped to grid, so the animation stays smooth
  even with snap-to-grid on.
- `autoLayoutRunning` disables the button (`wait` cursor on hover) and
  locks out drag/resize/pan/marquee-select for the duration (matching
  `wait` cursors across the canvas, nodes, and resize handles), so
  clicking around mid-animation can't silently fight the simulation's
  writes.
- `geometry.ts`'s `clampWithin` gained an optional 4th `topMargin`
  parameter (defaults to `margin`, so existing 3-arg callers are
  unaffected); `+page.svelte` passes a `CHILD_CONTAINMENT_TOP_MARGIN`
  (28) at every child-vs-parent clamp site, so a child can never be
  dragged, resized, or auto-laid-out over the area where its parent's
  title text renders.
- Integrates with Task 51's undo/redo (one undo point per auto-layout
  run, recorded before the animation starts) and Task 52's persistence
  (writes go through the same `checked`/`savedLayout` storage as every
  other diagram edit).
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), `deno task test` (68/68 pass at the time), and `deno fmt`
  (clean).

---

## Task 52 — Persist the diagram's camera (pan/zoom) state

From user testing feedback: diagram content (`checked`/`savedLayout`)
survived page reloads via `persisted()`, but the camera (pan/zoom) did
not, since `ViewEditorState.svelte`'s `create_editor_state()` was pure
in-memory `$state` (a deliberate factory, not a persisted singleton, per
Task 40 — so a future multi-view feature could create independent
instances without them fighting over shared state).

- `create_editor_state()` now takes an optional `storageKey` parameter.
  When omitted, behavior is unchanged (in-memory-only `$state`, as
  before). When given, it delegates to the *same* `persisted()` helper
  `checked`/`savedLayout`/`input`/`snapGridSize` already use — rather than
  re-implementing `localStorage` load/save a second time — reshaped via a
  `get view()` accessor so every existing call site in `+page.svelte`
  keeps mutating `editor_state.view.x/y/zoom` directly, exactly as before;
  only the single construction line changed, to
  `create_editor_state("DIAGRAM_VIEW")`.
- Keeping the storage key caller-supplied (not hardcoded inside
  `ViewEditorState.svelte`) preserves Task 40's original intent: two
  independent view instances (e.g. a future split view) would use two
  different keys and never collide, unlike a single global `persisted()`
  call baked into the module.
- Validated with `deno task check` (0 errors/warnings — including
  re-hitting and re-fixing the same `$state(...)` "must be assigned to a
  variable first" compiler error from Task 40), `deno task build`
  (succeeds), `deno task test` (78/78 pass, unaffected), and `deno fmt`
  (clean).

---

## Task 51 — Diagram edit history (undo/redo)

Grew out of Task 50's "undo/snapshot safety net" brainstorm idea, but
expanded per user request into a full general-purpose diagram undo/redo
system (Ctrl/Cmd+Z / Ctrl/Cmd+Y), not just a one-shot "undo the last
auto-layout" affordance.

- Added `web/src/routes/diagrams/history.ts`: a generic, bounded undo/redo
  stack (`createHistoryStack<T>()`, `pushHistory`, `undoHistory`,
  `redoHistory`) with zero dependency on any diagram-specific type — `T`
  is opaque to the module, so it's reusable for any snapshot-able state,
  not just the diagram layout. `pushHistory` clears the redo stack (a new
  edit invalidates the old "future"); both stacks are capped at a caller-
  supplied `limit`, discarding the oldest entry once exceeded. 10 Vitest
  tests in `history.test.ts`, using plain strings/numbers — no diagram
  context needed.
- `web/src/routes/diagrams/+page.svelte`: added a `DiagramSnapshot` type
  (`{ checked, savedLayout }` — deliberately excluding `selected` and
  view/grid/snap preferences, which aren't "diagram content") and a
  page-level `diagramHistory = createHistoryStack<DiagramSnapshot>()`,
  capped at `UNDO_HISTORY_LIMIT = 100`. `recordUndoPoint()` snapshots the
  current state (a shallow copy of both records — safe because
  `setNodeBox()` always replaces a `StoredBox` entry wholesale rather than
  mutating one in place, so a shallow copy is a fully independent
  snapshot) and pushes it; `undoDiagramEdit()`/`redoDiagramEdit()` pop the
  matching stack and call `applyDiagramSnapshot()`, which assigns fresh
  copies (`{ ...snapshot.checked }`) back onto `checked.value`/
  `savedLayout.value` and clears `selected` (a restored snapshot may not
  match the current selection).
- `recordUndoPoint()` is called once per *gesture*, not once per
  `setNodeBox()` write — at the top of `onNodeMouseDown`'s drag-start
  path, `onResizeHandleMouseDown`'s resize-start path, the sidebar
  checkbox's check/uncheck handler, `setSelectedTextAlign` (skipped for a
  no-op re-click of the already-active alignment), and once before
  `runAutoLayout`'s animation begins (not per-frame). A drag/resize/auto-
  layout's many intermediate writes are covered by the single snapshot
  taken at the gesture's start, so undo reverts the whole gesture in one
  step.
- Added `<svelte:window onkeydown={onDiagramKeyDown} />` to the page
  template. Deliberately page-scoped (not added to the app-wide
  `KeyboardState.svelte` module) since "undo" here specifically means
  "undo a diagram edit" — a different page (e.g. the HCL text editor)
  would want its own, unrelated undo behavior. Recognizes Ctrl/Cmd+Z
  (undo), Ctrl/Cmd+Y (redo, as requested), and also Ctrl/Cmd+Shift+Z
  (the Mac-idiomatic alternative redo binding) as a bonus. Both
  `undoDiagramEdit`/`redoDiagramEdit` are blocked while
  `autoLayoutRunning`, same as every other diagram-mutating interaction
  — restoring a snapshot mid-animation would just be immediately
  overwritten by the next frame.
- History is in-memory only (not persisted to `localStorage`), matching
  how undo history conventionally resets on reload in most editors; not
  wrapped in the existing `persisted()` helper.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), `deno task test` (78/78 pass — 10 new `history.test.ts`
  cases), and `deno fmt` (clean).

---

## Task 46 — Enforce containment during group-resize

- `applyGroupScale` (`web/src/routes/diagrams/+page.svelte`) now clamps
  each node's scaled box against its own `activeParentBox` (if any) before
  writing it, exactly mirroring what `applyGroupDelta` already did for
  drag — clamped individually per-node rather than solving for one "safe"
  group scale factor upfront. Resizing a group can therefore end up not
  perfectly uniform when some members are parent-constrained and others
  aren't, an accepted trade-off matching the one `applyGroupDelta` already
  documents for drag.
- Extracted the now-identical "clamp against own active parent, write via
  setNodeBox, cascade via reclampChildren" tail shared by both
  `applyGroupDelta` and `applyGroupScale` into one helper,
  `writeClampedToActiveParent(index, next)`. Both functions now only
  compute their own `next: Box` (a positional delta vs. a size/position
  scale) and delegate the rest to the shared helper — removing the last
  bit of duplication between the two.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), `deno task test` (47/47 pass, unaffected), and `deno fmt`
  (no changes needed). Manual browser verification (nest a component,
  select a group including it alongside unconstrained nodes, resize the
  group) was not performed in this environment — worth a spot check.

---

## Task 45 — Extend containment clamping to grandchildren (multi-level nesting)

- `reclampChildren(parentIndex)` in `web/src/routes/diagrams/+page.svelte`
  now recurses: after clamping each direct child of `parentIndex` against
  `parentIndex`'s box and writing it via `setNodeBox`, it calls
  `reclampChildren(childIndex)` on that same child, so grandchildren (and
  deeper) get re-clamped against their own just-updated parent in turn.
  Containment now cascades through the whole ancestor chain instead of
  stopping one level down.
- The recursion is naturally bounded by what's actually placed on canvas
  — `reclampChildren` already bails out early (`if (!parentBox) return;`)
  for any component without a box, so no separate depth limit was needed.
- `activeParentBox` (and the per-node clamp during drag) intentionally
  stayed unchanged — a node only ever needs to stay within its own
  *immediate* parent; the transitive part is entirely handled by
  `reclampChildren`'s cascade once a middle ancestor's box changes. Updated
  both functions' doc comments to describe this division of
  responsibility and removed the now-outdated reference to this being
  "explicitly out of scope" (that was this same task, previously
  postponed).
- Caught during manual review: `applyGroupScale` (which handles *all*
  resizing, single- or multi-node, since Task 42's refactor) never called
  `reclampChildren` at all, so resizing a parent didn't cascade
  containment to its children/grandchildren even after the fix above —
  only drag exercised the new recursion. Added `reclampChildren(index)`
  right after each `setNodeBox(index, next)` in `applyGroupScale`'s loop,
  mirroring `applyGroupDelta`, so resize now cascades containment to
  descendants exactly like drag does. `applyGroupScale` still
  intentionally does *not* clamp the resized node itself against its own
  parent (that remains Task 46's scope) — updated its doc comment to spell
  out that distinction precisely.
- This is UI-interaction-driven behavior not easily covered by the
  existing pure geometry unit tests; validated with `deno task check` (0
  errors/warnings), `deno task build` (succeeds), and `deno task test`
  (47/47 pass, unaffected). Manual browser verification (place a 3-level
  `A ⊃ B ⊃ C` hierarchy; drag `A` far enough that `B` clamps and confirm
  `C` follows; separately resize `A` and confirm `B`/`C` are re-clamped
  too) was not performed in this environment — worth a spot check.

---

## Task 44 — Make diagram tuning constants configurable

- Scoped to `SNAP_GRID_SIZE` only, per the task's own priority —
  `MIN_NODE_SIZE`, `ZOOM_TO_FILL_FRACTION`, `CHILD_CONTAINMENT_MARGIN`, and
  `TEXT_ALIGN_PADDING` stay hardcoded until a concrete need for exposing
  them shows up.
- Replaced `const SNAP_GRID_SIZE = 10;` in
  `web/src/routes/diagrams/+page.svelte` with `let snapGridSize =
  persisted("DIAGRAM_SNAP_GRID_SIZE", DEFAULT_SNAP_GRID_SIZE);`, reusing
  the same `persisted()` helper already backing
  `checked`/`savedLayout`/`input`, so the chosen grid size survives page
  reloads. Added `SNAP_GRID_SIZE_OPTIONS = [10, 20, 50, 100] as const`
  (fixed, "nice" round numbers that line up with
  MINOR_GRID_SPACING/MAJOR_GRID_SPACING) and a `DEFAULT_SNAP_GRID_SIZE`
  derived from it. `snap()` falls back to `DEFAULT_SNAP_GRID_SIZE`
  whenever the persisted value isn't positive (e.g. a hand-edited `0` or
  negative `localStorage` value), so it can never divide by a
  zero/negative grid size.
- Added a `<select>` dropdown (daisyUI `select select-sm`, grouped with
  the existing "Snap to Grid" button via a `join` wrapper so they read as
  one control) `bind:value={snapGridSize.value}`, populated from
  `SNAP_GRID_SIZE_OPTIONS`, next to the "Snap to Grid" button in the
  bottom-right button row — a fixed set of choices rather than a
  free-form numeric input, and rather than a general settings panel for a
  single value. Updated the button's tooltip to interpolate the live
  `snapGridSize.value` instead of the old constant.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), and `deno task test` (47/47 pass, unaffected by this
  change).

---

## Task 43 — Add schema validation for persisted diagram localStorage data

- Added `zod` (v4) as a `web/package.json` dependency and a new
  `web/src/routes/diagrams/persistence.ts` module: `StoredBoxSchema`
  (`z.object({ x: z.number(), y: z.number(), width: z.number().optional(),
  height: z.number().optional(), textAlign: z.enum(["center",
  "top-center", "top-left"]).optional() })`), `StoredBox` (now `z.infer<
  typeof StoredBoxSchema>` instead of a hand-written type — one source of
  truth for the shape), and `sanitizeStoredRecord()`.
- `sanitizeStoredRecord(record: Record<string, unknown>)` runs
  `StoredBoxSchema.safeParse()` **per entry** (not one whole-object parse),
  keeping every valid entry and dropping only the malformed ones, with a
  single `console.warn` naming every dropped key in one line.
- `web/src/routes/diagrams/+page.svelte` removed its hand-written
  `StoredBox` type (now imported from `persistence.ts`) and now chains
  `checked.value = sanitizeStoredRecord(stripLegacyIndexKeys(checked.value))`
  (same for `savedLayout`) right at load time — the one spot both existing
  migration logic and the new validation run, so every other read/write
  site (`nodeBox()`, `setNodeBox()`, the hot drag/resize path) keeps
  trusting that anything already in `checked.value` is well-formed.
- Added `web/src/routes/diagrams/persistence.test.ts` (13 tests, matching
  `geometry.test.ts`'s pattern): valid entries pass through unchanged,
  entries with only the required `x`/`y` still parse (backwards-compat
  with pre-width/height/textAlign data), non-numeric/missing/invalid
  fields and fully-malformed entries (`null`, a string, an array) are
  rejected, malformed entries are dropped independently of valid
  siblings, and the single-`console.warn`-naming-every-dropped-key
  behavior is asserted directly (via a `vi.spyOn(console, "warn")`).
- No behavior change for well-formed data — this is purely a guardrail
  for corrupted/hand-edited `localStorage` entries or future schema
  drift. Chose Zod (a TS-only schema library) over an earlier brainstormed
  Rust/serde/wasm approach: for a small, frequently-tweaked, frontend-only
  concern like this, a TS schema library wins on iteration speed, type
  inference (`z.infer`), and testability, even though the Rust option
  would better seed a future "backend defines the schema" pattern.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), and `deno task test` (47/47 — 34 existing geometry tests +
  13 new persistence tests — pass).

---

## Task 42 — Deduplicate drag/resize coordinate-and-clamp logic in the diagrams canvas

- Extracted the per-node write loops out of `onSvgMouseMove`'s
  `"dragging"`/`"resizing"` switch cases in
  `web/src/routes/diagrams/+page.svelte` into two named top-level
  functions:
  - `applyGroupDelta(startPositions, deltaX, deltaY)` — moves every node in
    a position snapshot by the same offset, clamping each individually to
    its own active parent and cascading via `reclampChildren`. Used for
    both single- and multi-node drags (a single dragged node is just a
    selection of one).
  - `applyGroupScale(startBoxes, groupBox, scaleX, scaleY)` — scales every
    node in a box snapshot by the same factor, relative to the selection's
    fixed top-left. Used for both single- and multi-node resizes.
- The two switch cases now each follow the same two-step shape: compute an
  anchor-derived parameter (a delta for drag, a scale factor for resize),
  then apply it to the whole snapshot via the corresponding helper —
  instead of inlining the per-node loop directly in the switch case.
- Pure refactor, no behavior change. Validated with `deno task check` (0
  errors/warnings), `deno task build` (succeeds), and `deno task test`
  (34/34 geometry tests still pass).

---

## Task 41 — Replace plain Set with SvelteSet for the selection state

- `selected` in `web/src/routes/diagrams/+page.svelte` is now `const
  selected = new SvelteSet<number>();` (imported from
  `svelte/reactivity`), replacing the old `let selected: Set<number> =
  $state(new Set());`. `SvelteSet` is deeply reactive on its own, so
  `add()`/`delete()`/`clear()` are directly tracked — no more
  reassigning a fresh `Set` just to trigger reactivity, and no more risk
  of a future direct `.add()`/`.delete()` call silently becoming a no-op.
- Simplified the three call sites that used to reconstruct a new `Set`:
  - `onNodeMouseDown`'s "replace selection with just this node" path is
    now `selected.clear(); selected.add(index);` instead of `selected =
    new Set([index]);`.
  - `onSvgMouseUp`'s marquee-commit path is now `selected.clear(); if
    (...) { for (const index of marqueeCandidates) selected.add(index); }`
    instead of ternary-constructing a whole new `Set`.
  - The sidebar checkbox's uncheck handler is now a single
    `selected.delete(index);` (removed the redundant `has()` check +
    copy-then-delete-then-reassign dance, since `delete()` on a key
    that isn't present is already a harmless no-op).
- `marqueeCandidates` (a `$derived.by` producing a brand new `Set` each
  recompute, never mutated in place) was deliberately left as a plain
  `Set` — it's freshly constructed every time, so there's no reactivity
  gap to fix there.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), and `deno task test` (34/34 geometry tests still pass).

---

## Task 40 — Make the diagram view (pan/zoom) page-scoped instead of a module-level singleton

- `web/src/ViewEditorState.svelte` no longer holds a module-level
  `editor_state` singleton or a `get_editor_state()` accessor. Replaced
  with `create_editor_state()`, a factory that returns a fresh
  `$state`-backed `ViewEditorState` (`{ view: { x, y, zoom } }`) on every
  call, plus the exported `ViewEditorState` type. `clamp_zoom()` is
  unchanged (already a pure, stateless function).
- `reset_view()` now takes the state instance to reset as a parameter
  (`reset_view(state: ViewEditorState)`) instead of implicitly resetting
  the old shared singleton.
- `web/src/routes/diagrams/+page.svelte` now calls
  `const editor_state = create_editor_state();` to construct its own
  independent instance, and the "Reset View" button now calls
  `reset_view(editor_state)`.
- This is a pure refactor with the diagrams page as the sole consumer, so
  behavior is unchanged today, but any future feature needing more than
  one independent diagram view (split view, a thumbnail preview, ...) can
  now just call `create_editor_state()` again instead of fighting over one
  shared pan/zoom. Matches the intentional distinction already documented
  in `ViewEditorState.svelte`: unlike genuinely global concerns
  (`KeyboardState.svelte`'s physical key state, `ThemeState.svelte`'s
  app-wide theme), pan/zoom is inherently per-view.
- Hit and fixed a Svelte compiler error (`$state(...) can only be used as
  a variable declaration initializer...`) from initially writing
  `create_editor_state()` as `return $state({...})` directly — `$state()`
  must be assigned to a local variable first, then returned.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), and `deno task test` (34/34 geometry tests still pass).

---

## Task 39 — Make diagram layout persistence keys stable across HCL source edits

- Added a minimal `SystemJS` wrapper (`label` getter only) and
  `ModelJS::systems()` to `crates/rhizz-wasm/src/lib.rs`, mirroring the
  existing `ComponentJS`/`ConnectionJS` wrapper pattern. System labels are
  globally unique (unlike component labels, which are only unique within
  their parent scope — SPEC.md §2.3), so a system's label is a safe root
  for a stable path. Rebuilt the wasm bindings with `wasm-pack build
  crates/rhizz-wasm --target web` so `web/src/routes/diagrams/+page.svelte`
  picks up the new binding (linked via the existing `"rhizz":
  "file:../crates/rhizz-wasm/pkg/"` dependency).
- Added `componentKey(index)` in `+page.svelte`, which walks the chain of
  `parent_component_index` up to the root and prepends the root's parent
  system's label (via the new `systems` derived + `parent_system_index`),
  producing a path like `"home-monitor/controller/mcu"`. This replaces the
  raw arena index as the storage key for both `checked` and `savedLayout`
  (now typed `Record<string, StoredBox>` instead of `Record<number,
  StoredBox>`), so reordering/inserting components earlier in the HCL
  source no longer silently reattaches a persisted position to the wrong
  component.
- Added `keyToIndex`, a `$derived.by` reverse map from `componentKey()` →
  current arena index, rebuilt whenever `components`/`systems` change.
  `renderOrder` now maps `Object.keys(checked.value)` through this reverse
  map (dropping keys that no longer resolve to a component) instead of
  parsing them back with `Number(...)`.
- All other read/write sites (`setNodeBox`, `nodeBox`,
  `setSelectedTextAlign`, `onNodeMouseDown`'s drag-start snapshot, and the
  sidebar checkbox's check/uncheck handlers) now key through
  `componentKey(index)` instead of the bare arena index.
- Migration: added `stripLegacyIndexKeys()`, run once against
  `checked.value`/`savedLayout.value` right after they're loaded. Old
  arena-index keys are plain-integer strings (e.g. `"0"`, `"1"`), which
  can never occur as a `componentKey()` path (a real path always contains
  at least one `"/"`, from its root system label), so they're identified
  unambiguously and dropped rather than left to linger unused in
  `localStorage` forever. There's no reliable way to migrate their values
  forward (the whole point of this change is that the old
  index→component mapping could silently be wrong), so anyone with
  pre-existing diagram layouts gets a one-time reset, as the task allowed.
- Fixed a TS7022 circular-inference compiler error (`'component'
  implicitly has type 'any' because it ... is referenced ... in its own
  initializer`) surfaced by `componentKey`'s `while` loop reassigning its
  loop variable, by explicitly annotating the loop-local `const component:
  ComponentJS | undefined = components[current]` (imported `ComponentJS`
  as a type from `"rhizz"`, matching the existing pattern in
  `Navbar.svelte`) — a known TypeScript design limitation with loops that
  both read and reassign a shared variable across iterations.
- Validated with `cargo build`/`cargo test --all` (rhizz-wasm + workspace,
  all pass; `cargo clippy` is unavailable in this sandbox's Nix devshell,
  so it could not be run for the Rust change), and `deno task check` (0
  errors/warnings), `deno task build`, and `deno task test` (all 34
  existing geometry tests still pass) for the frontend. Manual
  browser verification of reordering components in the HCL source was not
  performed (no interactive browser available in this environment) —
  recommend the user spot-check this manually.

---

## Task 38 — Replace ad hoc interaction state with a discriminated-union state machine

- In `web/src/routes/diagrams/+page.svelte`, replaced the four
  independently-nullable state variables `dragging`, `resizing`,
  `panning`, and `marquee` (plus the separate `MarqueeState` type) with a
  single discriminated union `Interaction` (`{ type: "idle" } | { type:
  "dragging", ... } | { type: "resizing", ... } | { type: "panning", ... }
  | { type: "marquee", ... }`) held in one `interaction: Interaction =
  $state({ type: "idle" })`. This restores the spirit of the old
  discriminated-union `EditorState` (`idle | moving_canvas | zooming`)
  that used to live in `ViewEditorState.svelte` before it was removed
  earlier in the session in favor of separate flags.
- Updated `onNodeMouseDown`, `onCanvasMouseDown`,
  `onResizeHandleMouseDown`, `onSvgMouseMove`, and `onSvgMouseUp` to read
  and write `interaction` via exhaustive `switch`/discriminant checks
  instead of independent `if` chains. `onSvgMouseMove` captures
  `const current = interaction;` at the top and switches on
  `current.type`, since TypeScript can't reliably narrow directly on a
  live `$state` binding across branches — each `case` body reads from
  `current`, and only reassigns the live `interaction` when it needs to
  persist updated fields (`panning`'s `lastX`/`lastY`, `marquee`'s
  `x`/`y`) for the next move event.
- `marqueeBox` (the derived marquee rectangle) is now computed from
  `interaction` via `$derived.by` with the same capture-then-narrow
  pattern, rather than from the old standalone `marquee` variable.
- Updated template usages: the SVG cursor style and the `ViewNode`
  snippet's `highlighted` computation now switch on `interaction.type`
  instead of checking the old `dragging`/`resizing`/`panning`/`marquee`
  variables directly.
- Pure refactor — no behavior change. Validated with `deno task check`
  (0 errors/warnings), `deno task build` (succeeds), and `deno task test`
  (all 34 existing geometry tests still pass).

---

## Task 37 — Add unit tests for the extracted geometry module

- Expanded `web/src/routes/diagrams/geometry.test.ts` from the initial
  3-function smoke test to full coverage of every exported function in
  `geometry.ts`: `boxCenter`, `boxContains`, `clampWithin`,
  `clampResizeWithin`, `unionBox`, `textPosition`, `boxBoundaryPoint`,
  `elbowPath`, `depthOf` — 34 tests total.
- `elbowPath` is tested structurally rather than via snapshot/exact-string
  matching (which would be brittle to assert on by hand and wouldn't
  independently verify correctness, only lock in whatever the current
  output happens to be). A small test-local `waypoints()` helper parses
  out the ordered M/L/A endpoints, and tests assert the property that
  actually matters: horizontal orientation keeps `y` fixed on the first
  and last legs (H-V-H), vertical orientation keeps `x` fixed on the first
  and last legs (V-H-V) — exactly the behavior fixed earlier when the
  original bug (always H-V-H regardless of orientation) was found.
- Hardened `unionBox` while writing its tests: an empty input array
  previously fell through to `Math.min()`/`Math.max()` on an empty array
  (`+/-Infinity`), silently producing garbage geometry. Now throws a clear
  error instead — every current call site (`onResizeHandleMouseDown`,
  `zoomToFill`) already guards against calling it with no boxes, so this
  is a pure hardening change with no behavior change at any real call
  site.
- Validated with `deno task test` (34/34 passing), `deno task check`, and
  `deno task build`.

---

## Task 36 — Extract pure geometry helpers from diagrams/+page.svelte into a dedicated module

- Created `web/src/routes/diagrams/geometry.ts`, a Svelte/DOM-independent
  module holding `clampWithin`, `clampResizeWithin`, `unionBox`,
  `boxContains`, `boxCenter`, `boxBoundaryPoint`, `elbowPath`,
  `textPosition`, `depthOf`, the `Box`/`ConnectionOrientation`/`TextAlign`
  type aliases, and the `MIN_NODE_SIZE`/`TEXT_ALIGN_PADDING` constants they
  depend on.
- `depthOf` was refactored to take an explicit `parentOf: (index) => number
  | undefined` lookup function instead of closing over the reactive
  `components` array, so it's a pure function usable outside the
  component. `+page.svelte` now defines a small `parentOf` wrapper and
  passes it at the call site.
- `+page.svelte` imports everything it needs from `./geometry` instead of
  defining these inline; `snap()` stayed in the component since it reads
  component-local `snapActive` state.
- No behavior change — confirmed via `deno task check` and `deno task
  build`, both passing identically to before the extraction.
- Set up the test infrastructure this unblocks: added `vitest` to
  `web/package.json` (`deno task test` runs `vitest run`, using Deno's
  fallback to `package.json` scripts — no `deno.json` task needed), and
  configured it via `test: {...}` in `vite.config.ts` (imported from
  `"vitest/config"` instead of plain `"vite"` for typing). No DOM
  environment configured yet, since only pure-function tests exist so far;
  add jsdom/happy-dom + `@testing-library/svelte` if/when component tests
  are needed.

---

## Task 35 — Enforce parent/child containment constraints on the canvas

- Added `activeParentBox(index)`: returns a node's parent's box, but only
  if that parent is itself currently placed ("active") on the canvas —
  built on `ComponentJS.parent_component_index` (already exposed by
  `rhizz-wasm`) and the index-keyed canvas state from Task 29.
- Added a pure `clampWithin(child, parent, margin)` helper: clamps the
  child's position (and shrinks its size if it doesn't fit) so its full box
  stays inside the parent's box, inset by `CHILD_CONTAINMENT_MARGIN` (`10`
  world units). Used for drag, initial placement, and cascading, where the
  child's top-left corner is free to move.
- Added a second pure helper, `clampResizeWithin(box, parent, margin)`, for
  the resize case specifically — resizing keeps the top-left corner fixed,
  so only width/height are capped against the parent's remaining inner
  space (rather than also letting position float, which `clampWithin`
  does).
- Added `reclampChildren(parentIndex)`: re-clamps every currently-placed
  *direct* child of a parent against the parent's current box. Called
  after every parent drag/resize move event (so children's constraint
  region follows live, not just on drop) and after checking a new
  component (in case it's a parent of children that were already placed).
- Wired the clamp into `onSvgMouseMove`'s `dragging` and `resizing`
  branches, and into the sidebar checkbox's initial-placement logic
  (replacing the old blind `(100, 100)` default when the parent is active).
- Added `depthOf(index)` (walks the `parent_component_index` chain) and a
  `renderOrder` derived value (currently-placed indices sorted
  shallowest-first) so parents always paint before their children,
  regardless of arena order — otherwise a child could end up visually
  hidden behind its parent's fill.
- End-to-end result: place a composite component and one of its children
  (e.g. the example system's `controller` → `mcu`/`power-supply`) —
  dragging/resizing the child is bounded to the parent's box; moving/
  resizing the parent carries the constraint region with it live.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds). Also independently
  validated the new example-system hierarchy (added earlier) against the
  real Rust checker (`cargo run -p rhizz-cli -- check/score`): 0 errors, 0
  warnings, 100% completion score.

---

## Task 34 — Add text alignment control to the node inspector

- Extended the per-node record (from Task 31) with an optional
  `textAlign?: "center" | "top-center" | "top-left"` field (a new
  `TextAlign` type alias); `nodeBox()` backfills it to `"center"`
  (`DEFAULT_TEXT_ALIGN`) for entries persisted before this task.
- Added `setSelectedTextAlign(align)` to update the currently selected
  node's alignment, and a `selectedBox` derived value so the inspector can
  read the current value.
- Added a 3-button daisyUI `join` segmented control ("Center" / "Top" /
  "Top-left") to the inspector panel from Task 33, highlighting the active
  option with `btn-primary`.
- Added `textPosition(align, width, height)`, mapping alignment to the
  label `<text>`'s `x`/`y`/`text-anchor`/`dominant-baseline`; the two
  top-aligned variants are inset by `TEXT_ALIGN_PADDING` (`8` world units)
  from the node's edges.
- `ViewNode` snippet and its render call site now thread `textAlign`
  through from `nodeBox()`.
- End-to-end result: select a node, change alignment in the inspector, the
  label repositions live inside the box and persists across reload.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 33 — Add left-side inspector panel for the selected node

- Added a `selectedComponent` derived value (`components[selected] ?? null`)
  on `web/src/routes/diagrams/+page.svelte`.
- Added a new left sidebar, shown only when `selectedComponent` is set,
  mirroring the existing right sidebar's structure/styling (`w-64 shrink-0
  bg-base-100 text-base-content p-4 overflow-y-auto`, `border-r` instead of
  `border-l` since it sits on the opposite side).
- For now, shows the selected component's label (header) and description
  (if any) — an empty shell with a placeholder comment marking where style
  controls (text alignment, etc.) will be added in Task 34.
- End-to-end result: selecting a node opens the panel; deselecting (or
  unchecking the selected component) closes it.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 32 — Add corner-drag resize interaction for the selected node

- Added a small resize-handle square at the bottom-right corner of a node,
  rendered only when that node is `selected`.
- Added `resizing: { index: number } | null` state, mirroring the existing
  `dragging`/`panning` pattern. Resize keeps the node's top-left corner
  fixed and recomputes `width`/`height` live from the pointer's current
  world-space position each move event (via the existing `svgPoint()`
  helper, so pan/zoom are automatically accounted for) — no delta-tracking
  needed. Size is clamped to a `MIN_NODE_SIZE` (`40`) floor.
- The handle's `onmousedown` calls `event.stopPropagation()` so it doesn't
  also bubble into the node's own `onmousedown` (which would start a drag
  at the same time).
- `onSvgMouseMove`/`onSvgMouseUp` extended with a `resizing` branch
  alongside `dragging`/`panning`; cursor style now also shows `grabbing`
  while resizing.
- **Fixed a latent bug found while implementing this**: node dragging was
  overwriting the entire `checked.value[index]` record with just `{x, y}`,
  silently dropping any custom `width`/`height` set in Task 31 on every
  drag move. Changed to a spread merge (`{...box, x, y}`) so size survives
  dragging.
- End-to-end result: select a node, drag its corner, it resizes (respecting
  the minimum size) and the new size persists across reload.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 31 — Add resizable size to diagram nodes (data model)

- Extended the per-node persisted record from `{x, y}` to
  `{x, y, width?, height?}` (`width`/`height` optional in storage so entries
  persisted before this task still parse without a migration step).
- Added `nodeBox(index)`, a helper that reads a checked node's position and
  size, backfilling `DEFAULT_NODE_WIDTH`/`DEFAULT_NODE_HEIGHT` (`100x100`,
  matching the previous hardcoded size) when `width`/`height` are missing.
- `nodeCenter` now derives the centre point from `nodeBox`'s actual
  width/height instead of the fixed `+50` offset.
- The `ViewNode` snippet and its canvas call site now render dynamic
  `width`/`height` (via `{@const box = nodeBox(index)}`) instead of the
  hardcoded `"100"`/`"100"`; the label text re-centers at `width/2, height/2`.
- Checking a new component from the sidebar now writes `width`/`height`
  explicitly (still defaulting to `100x100`), so freshly-placed nodes don't
  rely on the backfill path.
- No visible/behavioral change yet (all nodes still default to `100x100`),
  but the data model now supports variable node size — unblocks Task 32.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 30 — Add node selection state to the diagram canvas

- Added `selected: number | null` (component arena index) as page state on
  `web/src/routes/diagrams/+page.svelte`. Not persisted — selection is
  transient UI state.
- `onNodeMouseDown` now sets `selected = index`; `onCanvasMouseDown`
  (background rect, already used for panning) sets `selected = null`, so
  clicking empty canvas deselects.
- Selected node renders with an accent-colored (`var(--color-primary)`),
  slightly thicker stroke instead of the default white one.
- Edge case: unchecking a component from the sidebar while it's selected
  now also clears `selected`, avoiding stale selection pointing at a node
  that's no longer rendered.
- No sidebar yet (that's Task 33) — this step only proves the selection
  mechanic and gives visual feedback.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 29 — Rekey diagram canvas state by component index instead of label

The `/diagrams` canvas keyed its per-node state (`checked`) by
`component.label`. Per `SPEC.md` §2.3, labels are only guaranteed unique
**within a parent scope** — two components in different branches of a
hierarchical model may legally share a label (e.g. two different `"mcu"`
leaves under two different composites), so label-keyed canvas state would
collide once nested components appear on the same canvas.

- Changed `checked`'s keys (and the sidebar checkbox `id`s) from
  `component.label` to the component's arena index (its position in
  `model.components()`), matching the index space already used by
  `ConnectionJS.from`/`to` and `ComponentJS.parent_component_index`.
- `web/src/routes/diagrams/+page.svelte`: `dragging`, `nodeCenter`,
  `onNodeMouseDown`, `checked`'s type, and both `{#each}` loops (canvas nodes
  and sidebar list) now use the numeric index instead of the label string.
- Simplified `visibleConnections`: since `conn.from`/`conn.to` are already
  component indices, dropped the now-unnecessary `model.component_by_id(...)`
  lookups that existed solely to get `.label` for the old `nodeCenter(label)`
  calls.
- No visible behavior change (existing persisted layouts under the old
  label-keyed scheme will not carry over, since the key space changed).
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 27 — Typed WASM wrappers for rhizz-core structs

Implement `#[wasm_bindgen]` wrapper structs in `rhizz-wasm` for the core types
the web frontend needs. Each wrapper converts from its `rhizz-core` counterpart
via a `From` impl and exposes fields as `#[wasm_bindgen(getter)]` methods so
that `wasm-pack` generates typed TypeScript class definitions.

- Removed the `TestStruct` / `InnerStruct` scaffolding.
- Added wrapper structs: `DiagnosticJS`, `ComponentJS`, `ScoreReportJS`,
  `CategoryScoreJS`, `ProjectJS`.
- Each wrapper derives `Clone` and implements `From<&rhizz_core::T>`.
- Exposed all fields relevant to the frontend as `#[wasm_bindgen(getter)]`
  methods (strings, numbers, booleans, `Vec<primitive>`). For nested
  wasm_bindgen structs, return the wrapper type directly.
- Updated `CompileResultJS` methods:
  - `diagnostics() -> Vec<DiagnosticJS>` (typed, replaces `JsValue` version)
  - `error_count() -> usize`
  - `warning_count() -> usize`
  - `components() -> Vec<ComponentJS>` (returns empty vec when model is `None`)
  - `score() -> Option<ScoreReportJS>` (calls `rhizz_core::score()`, returns
    `None` when model is `None`)
  - `project() -> Option<ProjectJS>`
- Updated `tests/wasm_test.rs` to exercise the new typed API.
- Spec reference: `SPEC/frontend.md` § WASM Integration.

---

## Task 26 — Replace SPEC.md §4 tables with a pointer to `SPEC/diagnostics/`

Remove the error and warning tables from SPEC.md §4.1 and §4.2 and replace them
with a reference to the `SPEC/diagnostics/` folder. The section should state
that each code is documented in its own file and list the folder path.

### Acceptance criteria

- SPEC.md §4.1 and §4.2 no longer contain the per-code tables.
- §4 includes a note such as: "Each diagnostic code is documented in its own
  file under `SPEC/diagnostics/` (e.g. `E001.md`, `W003.md`). Error codes
  (`Exxx`) halt compilation; warning codes (`Wxxx`) are non-blocking."
- The rest of SPEC.md is unchanged.
- No code changes in this task.

---

## Task 25 — Attach diagnostic Markdown to `DiagnosticCode` via `include_str!`

Use `#[doc = include_str!(...)]` on each `DiagnosticCode` const to pull the long
description from the corresponding `SPEC/diagnostics/*.md` file. Remove the
hand-written one-liner doc comments that are now redundant.

**Spec reference:** SPEC/diagnostics/*.md (created in Task 25).

### Acceptance criteria

- Every `DiagnosticCode` const (`E000`–`E011`, `W000`–`W011`) has
  `#[doc = include_str!("../../../SPEC/diagnostics/Xxxx.md")]` instead of a
  hand-written doc comment. (Note: actual path is `../../../` from the source
  file.)
- `cargo doc` generates documentation that includes the full markdown content
  (description, HCL examples) for each code.
- `cargo test --all`,
  `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
  `cargo build`, `cargo fmt` all pass.

---

## Task 24 — W012: orphan top-level component warning

Detect top-level components that are not referenced by any `source` attribute
anywhere in the model and emit warning W012.

**Spec reference:** SPEC.md §4.2 (W012).

### Acceptance criteria

- New `DiagnosticCode::W012` is defined.
- After resolving all systems and expanding all `source` references, the
  resolver tracks which top-level component labels were actually used. Any
  unused labels produce W012.
- Unit tests:
  - A top-level component referenced by `source` → no W012.
  - A top-level component not referenced by any `source` → W012.
  - A top-level component referenced multiple times → no W012.
- All existing tests continue to pass (no orphan top-level components exist in
  the examples after Task 23).
- `cargo test --all`,
  `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
  `cargo build`, `cargo fmt` all pass.

---

## Task 23 — Update drone example to use `source`

Now that all the infrastructure is in place (Tasks 20–22), update the drone
example to demonstrate the feature end-to-end.

**Spec reference:** SPEC.md §2.3.

### Acceptance criteria

- In `examples/drone/systems.hcl`, replace the inline `flight-controller`
  component (approx 120 lines of ports, children, connections) with:
  ```hcl
  component "flight-controller" {
    source = "flight-controller"
  }
  ```
- `examples/drone/components/flight-controller.hcl` already exists as a
  top-level `component "flight-controller" { … }` with the full body. Verify it
  matches the removed inline definition (same ports, children, connections).
- `examples/drone/README.md` is updated to mention the `source` feature and list
  the `components/flight-controller.hcl` file.
- All integration tests that compile the drone example pass — the resolved model
  must be identical (same components, ports, connections, messages, scores,
  views) to the previous inline version.
- `cargo test --all`,
  `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
  `cargo build`, `cargo fmt` all pass.

---

## Task 22 — Add `source` attribute and resolve component references

Add the `source` attribute to `RawComponent` and implement resolution: when a
component inside a system (or parent component) has `source = "some-label"`, the
resolver looks up the top-level component with that label, validates
exclusivity, detects cycles, and clones the body into the sourced component
slot.

**Spec reference:** SPEC.md §2.3 (source rules), SPEC/models.md (source
resolution during resolution pass).

**Important:** do NOT modify any existing example `.hcl` files in this task.
Write unit tests that exercise `source` with inline HCL strings. The drone
example update is Task 23.

### Acceptance criteria

- `RawComponent` gains `source: Option<String>`.
- `ComponentAttrs` serde helper gains `source: Option<String>`.
- `parse_component` reads the `source` attribute from HCL.
- New `DiagnosticCode` variants: `E012`, `E013`, `E014` are defined and emitted:
  - E012: component with `source` has other attributes or child blocks.
  - E013: circular `source` chain detected.
  - E014: `source` references an undefined top-level component.
- During resolution, before walking a system's component tree, the resolver
  builds a `HashMap<String, RawComponent>` from `RawFile.components`. Duplicate
  top-level component labels → E001.
- When a component has `source`:
  1. Check exclusivity (E012).
  2. Look up the label in the top-level component map (E014 if missing).
  3. Check the ancestor set for cycles (E013).
  4. Clone the top-level component's body (description, tags, level, leaf,
     ports, children, connections) into the sourced slot. The label at the usage
     site is kept.
  5. Recurse into the cloned children for nested `source` references.
- Unit tests (all using inline HCL strings — no example file changes):
  - Component with `source` pointing to a valid top-level component → body
    cloned correctly, resolved model is identical to inline definition.
  - Component with `source` + inline `description` → E012.
  - Component with `source` pointing to undefined label → E014.
  - Circular `source` (A sources B, B sources A) → E013.
  - Nested `source` (A sources B, B has child that sources C) → works.
  - Same top-level component sourced into two different systems → works.
- All existing tests continue to pass.
- `cargo test --all`,
  `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
  `cargo build`, `cargo fmt` all pass.

---

## Task 21 — Recursive file discovery

The CLI's `load_sources` and the test helper `parse_dir` currently scan only
`max_depth(1)`. Change them to recursively discover all `.hcl` files in the
project directory tree so that files in subdirectories are parsed and merged
like any other file.

**Spec reference:** SPEC.md §1 (project structure).

**Why this is safe now:** Task 20 already taught the parser to accept top-level
`component` blocks. After this task, the drone example's
`components/flight-controller.hcl` will be discovered and parsed, but since it
only adds entries to `RawFile.components` (which the resolver currently
ignores), no tests break.

**Important:** do NOT modify any example `.hcl` files in this task. Existing
tests should pass as-is.

### Acceptance criteria

- `load_sources` in `rhizz-cli/src/cli.rs` uses `WalkDir::new(dir)` without
  `max_depth(1)` — all `.hcl` files at any depth are collected and returned.
- `parse_dir` test helper in `rhizz-core/src/parse.rs` is updated the same way.
- `rhizz-gui` file discovery is updated the same way.
- All existing tests and examples pass unchanged.
- `cargo test --all`,
  `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
  `cargo build`, `cargo fmt` all pass.

---

## Task 20 — Parse top-level `component` blocks

- Added `components: Vec<Labeled<RawComponent>>` field to `RawFile`.
- `parse_file` now handles `"component"` as a top-level block identifier.
- `merge_into` concatenates `components` vecs from all files.
- Unit tests: top-level component parses, mixed blocks parse, merge across
  files.

---

## Task 19 — Replace custom RenderBackend with SVG rasterization in rhizz-gui

**Note:** this task has been cancelled, rendering quality & performance were
unsatisfactory. No code changes were made.

The current `EguiBackend` (`RenderBackend` impl, ~300 lines) re-implements
primitive drawing on top of `layout-rs` internals. Replace it with `layout-rs`'s
built-in SVG output rasterized by `resvg` + `tiny-skia`, displayed as an
`egui::ColorImage` texture.

## Task 18 — Spec v0.3: Migrate rhizz-cli and rhizz-gui frontends

### rhizz-cli

- Update `ScoreReport` display: show `Ports` and `Connections` rows instead of
  `Interfaces`
- Update JSON output `score` object: replace `"interfaces"` with `"ports"` and
  `"connections"` keys
- Update human-readable diagnostic examples if any are hardcoded
- Update CLI tests (16 tests)

### rhizz-gui

- Sidebar tree: replace interface listing with connections listing; optionally
  show ports under each component
- Any references to `model.interfaces` → `model.connections`
- Update GUI tests (5 tests)

Run: `cargo test --all`,
`cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
`cargo build`, `cargo fmt`

---

## Task 17 — Spec v0.3: Migrate rhizz-mermaid renderer

Same changes as Task 16 but for Mermaid output.

- Replace `InterfaceId`/`Interface`/`Direction` references with
  `ConnectionId`/`Connection`
- Infer arrow style from port roles: `-->` (unidirectional), `<-->`
  (bidirectional), `-.->` (unknown/ambiguous)
- Messages from connected ports when rendering edge labels
- Update all Mermaid rendering tests (14 tests)

Run: `cargo test -p rhizz-mermaid`,
`cargo clippy -p rhizz-mermaid -- -D warnings`, `cargo fmt`

---

## Task 16 — Spec v0.3: Migrate rhizz-dot renderer

Update DOT rendering to use `Connection` + `Port` instead of `Interface`.

- Replace all `InterfaceId`/`Interface` references with
  `ConnectionId`/`Connection`
- Infer edge direction from port roles on `ConnectionEndpoint`:
  - `provider` → `consumer`: directed arrow
  - `consumer` → `provider`: reversed arrow
  - `peer` ↔ `peer`: undirected line (`dir=none`)
  - Either side untyped or roles ambiguous: dashed line
- When `show_messages = true`, collect messages from the connected port(s) (both
  endpoints if both are typed)
- Edge `ltail`/`lhead` logic uses `ConnectionEndpoint.component` (unchanged
  concept, new type)
- Update all DOT rendering tests (14 tests)

Run: `cargo test -p rhizz-dot`, `cargo clippy -p rhizz-dot -- -D warnings`,
`cargo fmt`

---

## Task 15 — Spec v0.3: Migrate rhizz-core + examples to ports & connections

This is the core migration from spec v0.2 (interface-centric) to spec v0.3
(port + connection model). After this task, `cargo test -p rhizz-core` must
pass. Downstream crates (rhizz-dot, rhizz-mermaid, rhizz-cli, rhizz-gui) will
have compile errors until their migration tasks are completed.

### model.rs changes

**Add new types:**

- `PortId(usize)`, `ConnectionId(usize)` newtypes
- `PortRole` enum: `Provider`, `Consumer`, `Peer`
- `Port` struct: `label`, `description`, `protocol`, `role: PortRole`, `tags`,
  `owner: ComponentId`, `messages: Vec<MessageId>`
- `ConnectionEndpoint` struct: `component: ComponentId`, `port: Option<PortId>`
- `Connection` struct: `label`, `description`, `tags`, `level`,
  `from: ConnectionEndpoint`, `to: ConnectionEndpoint`,
  `encapsulates: Vec<ConnectionId>`
- `RawPort` struct: `description`, `protocol`, `role`, `tags`,
  `messages: Vec<Labeled<RawMessage>>`
- `RawConnection` struct: `description`, `tags`, `level`, `from`, `to`,
  `encapsulates`

**Remove:** `Interface`, `InterfaceId`, `Direction`, `RawInterface`

**Update:**

- `Component`: `interfaces: Vec<InterfaceId>` →
  `connections: Vec<ConnectionId>`, add `ports: Vec<PortId>`
- `System`: `interfaces: Vec<InterfaceId>` → `connections: Vec<ConnectionId>`
- `Model`: `interfaces: Vec<Interface>` → `connections: Vec<Connection>`, add
  `ports: Vec<Port>`
- `RawSystem`: `interfaces` → `connections: Vec<Labeled<RawConnection>>`
- `RawComponent`: `interfaces` → `connections`, add
  `ports: Vec<Labeled<RawPort>>`
- `lib.rs`: update public exports

### parse.rs changes

- Parse `port "label" { protocol, role, tags, message... }` inside `component`
  blocks
- Parse `connection "label" { from, to, tags, level, encapsulates }` instead of
  `interface`; no `direction`, `leaf`, or `message` children
- Messages are parsed inside `port`, not `connection`
- Update all parse unit tests

### examples/ changes

Rewrite all three example projects (drone, social-media, software-house) `.hcl`
files:

- `interface` blocks → `connection` blocks (remove `direction`, `leaf`; move
  messages out)
- Add `port` blocks on components with `protocol`, `role`, and relocated
  `message`/`field` blocks
- Use `comp:port` syntax in `connection` `from`/`to` where appropriate
- Keep some bare `from`/`to` references to exercise W007 (gradual specification)

### resolve.rs changes

- Parse `from`/`to` strings: split on `:` to get `(comp_label, port_label)` or
  treat as bare component label
- Build `ScopeIndex.ports: HashMap<(ComponentId, String), PortId>` during
  component registration
- Update `ScopeIndex.interfaces` → `ScopeIndex.connections`
- Resolve `ConnectionEndpoint` with optional `PortId`
- Error code changes:
  - E005: leaf component with child components **or connections** (was "or
    interfaces")
  - Remove E006 (leaf interface with messages) — no longer applicable
  - Remove E008 (invalid direction) — no longer applicable
  - Renumber: E007→E006 (undefined system in view), E009→E007 (field missing
    type), E010→E008 (duplicate project)
  - Add E009 (invalid `port.role`), E010 (`comp:port` port not found), E011
    (`comp:port` component not found)
- Update all resolution tests

### validate.rs changes

- Remove W002 (non-leaf interface with no messages)
- Renumber: W003→W002 (message no fields), W004→W003 (orphan component — check
  connections now), W005→W004 (missing description), W006→W005 (from==to same
  component), W007→W006 (level decreases)
- Add W007 (one side typed, other not), W008 (protocol mismatch between
  connected ports), W009 (incompatible port roles), W010 (unused port), W011
  (port has no messages)
- Update all validation tests

### score.rs changes

- Remove interface scoring
- Add port scoring: complete (≥1 message, all complete), partial, incomplete (no
  messages)
- Add connection scoring: complete (both sides typed, matching protocol),
  partial (one side typed), incomplete (both untyped)
- `ScoreReport`: add `ports` and `connections` categories, remove `interfaces`
- Leaf component with description and no ports → still Complete (1.0)
- Update all scoring tests

Run: `cargo test -p rhizz-core`, `cargo clippy -p rhizz-core -- -D warnings`,
`cargo fmt`

---

## Task 14 — File watcher + live recompile

Register a `notify` watcher on the project directory. Recompile and refresh all
panels on any `.hcl` change.

- Use the same `notify` + `mpsc` + debounce pattern as `rhizz-cli`'s `watch`
  command (200 ms debounce).
- Keep the last successfully resolved `Model` in memory. If the new compile has
  hard errors, show the new diagnostics but continue rendering the previous
  valid model everywhere else.
- A small status bar at the bottom shows either "OK" or "X errors, Y warnings"
  after each recompile.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 13 — Startup load + diagnostic pane

On launch, read all `.hcl` files from the project directory argument, call
`rhizz_core::compile`, and display results in the window.

- A scrollable bottom pane lists every diagnostic (`code`, `file`, `line`,
  `message`); errors in red, warnings in yellow.
- A left sidebar lists every system, component, and interface by name (flat list
  is fine).
- No watcher yet — compile once at startup and display the static result.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 12 — Scaffold `rhizz-gui` crate

Add `crates/rhizz-gui` to the Cargo workspace as a new binary crate.

- Add `rhizz-gui` to the `members` list in the root `Cargo.toml`.
- Create `crates/rhizz-gui/Cargo.toml` with dependencies: `eframe`, `egui`,
  `rhizz-core`, `rhizz-dot`, `notify`, `walkdir`, `anyhow`.
- `src/main.rs` accepts a single positional CLI argument — a path to a project
  directory — and opens a blank `eframe` window titled "rhizz" with the path
  shown in the title bar.
- No model logic yet; the window just needs to open without panicking.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 11 — `watch` command for rhizz-cli

Add a `rhizz watch <path>` command to `rhizz-cli` that behaves identically to
`rhizz build` but reruns the full build pipeline automatically whenever any
`.hcl` file in the project directory changes.

### Acceptance Criteria

- `rhizz watch <path>` performs the same pipeline as `rhizz build` (parse →
  validate → score → views) on startup, then sits in a loop waiting for
  file-system events.
- On any create, modify, or delete event for a `.hcl` file under `<path>`, the
  pipeline is rerun from scratch and the output is reprinted.
- Use the [`notify`](https://crates.io/crates/notify) crate (cross-platform;
  wraps `inotify` on Linux, `FSEvents` on macOS, `ReadDirectoryChangesW` on
  Windows) — **not** the `inotify` crate directly, so the feature works on macOS
  and Windows too.
- A short debounce period (e.g. 200 ms) prevents re-running the pipeline
  multiple times for a single logical save that produces several rapid events.
- The command can be interrupted cleanly with Ctrl-C (SIGINT); on exit it prints
  a short "Stopped watching." message and exits with code 0.
- All existing flags (`--strict`, `--json`, `--output-dir`, `--no-color`) are
  forwarded to the inner build pipeline exactly as they are for `rhizz build`.
- The `notify` dependency must be added only to `rhizz-cli/Cargo.toml`, not to
  `rhizz-core` or `rhizz-dot`.

### Implementation Notes

- Add `Watch` variant to the existing `Command` enum in `cli.rs`, with the same
  arguments as `Build`.
- Extract (or reuse) the existing `run_build` helper so both `build` and `watch`
  call it.
- The watch loop should live in a new function `run_watch` in `cli.rs` (or a new
  `watch.rs` module if you prefer).
- Use `notify::recommended_watcher` with a `std::sync::mpsc` channel; filter
  received events to `.hcl` extension before triggering a rebuild.
- Print a clear "Watching <path> for changes…" banner before the initial build
  so the user knows the watcher is active.

### Tests

- Integration test: spawn `rhizz watch` against one of the `examples/`
  directories, modify an `.hcl` file, and assert that the command prints the
  build output a second time. Use a timeout to avoid hanging CI.
- Unit test: verify the debounce logic does not trigger multiple rebuilds for
  events arriving within the debounce window.

---

## Task 10 — Migrate CLI into `rhizz-cli`

Move `cli.rs` and the `main.rs` entry point into `crates/rhizz-cli/src/`. Add
`rhizz-core` and `rhizz-dot` as path dependencies. The CLI crate must contain no
parsing, validation, scoring, or DOT-rendering logic of its own — all calls
delegate to the two library crates. Move integration tests (examples: drone,
social-media, software-house) to `crates/rhizz-cli/tests/`. Verify that the
`rhizz` binary behaviour is identical to before.

Then:

Delete the old `src/` directory at the repo root once all code has migrated. Run
`cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
`cargo doc --all`, and `cargo build --all`. Fix any warnings or errors surfaced.
Run `cargo fmt --all`.

---

## Task 9 — Establish `rhizz-dot`

Move `dot.rs` into `crates/rhizz-dot/src/`. Expose
`fn render_view(model: &Model, view: &View) -> String`. Add `rhizz-core` as a
path dependency. No I/O. All pre-existing tests travel with the module.

---

## Task 8 — Establish `rhizz-core`

Move `model.rs`, `parse.rs`, `resolve.rs`, `validate.rs`, and `score.rs` from
`src/` into `crates/rhizz-core/src/`. Expose a clean public API:

- `Source { filename: String, content: String }`
- `CompileResult { model: Option<Model>, diagnostics: Vec<Diagnostic> }`
- `fn compile(sources: &[Source]) -> CompileResult`
- `fn score(model: &Model) -> ScoreReport`

All public types must derive `Clone`, `serde::Serialize`, and
`serde::Deserialize`. The crate must have **no** `std::fs`, `std::env`, or any
I/O dependency. All pre-existing unit tests travel with their modules; they must
pass under the new crate.

---

## Task 7 — Convert root to a Cargo workspace

Replace the root `Cargo.toml` `[package]` section with a `[workspace]` manifest
that lists `crates/rhizz-core`, `crates/rhizz-dot`, and `crates/rhizz-cli` as
members. Create the three `crates/` subdirectories, each with a skeleton
`Cargo.toml` and empty `src/lib.rs` (or `src/main.rs` for the CLI). Verify that
`cargo build` succeeds on the empty workspace.

---

## Task 6 — CLI

- Implement `clap` arg parser as specified in `SPEC/cli.md`: `check`, `score`,
  `views`, `build` subcommands; default to `build`
- Implement human-readable diagnostic output: `✗ E002  file.hcl:14  message` /
  `⚠ W001 ...`
- Implement `--json` output mode with the schema from `SPEC/cli.md`
- Implement `--strict` (warnings → errors), `--no-color`, `NO_COLOR` env var,
  non-TTY detection
- Wire exit codes: `0` on success, `1` on errors (or warnings under `--strict`)
- **Test:** run `rhizz build` on each example, assert exit code and stdout
  content

---

## Task 5 — Graphviz DOT Generation

- Implement `render_view(model: &Model, view: &View) -> String`
- Apply filter predicates: tag inclusion/exclusion, `max_level`, component
  whitelist, `show_messages`
- Emit `subgraph cluster_*` for non-leaf components, box nodes for leaf
  components
- Emit directed/undirected edges for interfaces; include message names in edge
  labels when `show_messages = true`
- Write rendered `.dot` files to `--output-dir`
- **Test:** render all views in each example; assert output contains expected
  node/edge identifiers

---

## Task 4 — Completion Scoring

- Implement `score(model: &Model) -> ScoreReport` with the per-entity
  0.0/0.5/1.0 logic from SPEC.md §5
- Produce per-category counts (components/interfaces/messages) and overall
  aggregate
- Implement `ScoreReport` display formatting matching the spec output format
- **Test:** assert score values for each example match hand-calculated
  expectations

---

## Task 3 — Validation and Warnings

- Implement a warning pass over the resolved `Model`, emitting W001–W007 as
  non-blocking `Diagnostic` values
- Implement `Diagnostic` type with fields: `code`, `file`, `line` (optional),
  `message`
- **Test:** assert that each example emits exactly the expected warning codes
  and none of the examples produce unexpected errors

---

## Task 2 — Resolution

- Define resolved model types and newtyped ID structs (`ComponentId`,
  `InterfaceId`, etc.) and the full `Model` arena as described in
  `SPEC/models.md`
- Implement
  `resolve(raw: RawFile) -> Result<(Model, Vec<Diagnostic>), Vec<Diagnostic>>`:
  - Walk raw tree depth-first, allocate IDs, populate arenas
  - Build `ScopeIndex` mapping `(Scope, label) → id` for components and
    interfaces
  - Resolve `from`/`to` and `encapsulates` references via scope lookup
  - Apply all defaults (`level` auto-increment, `leaf = false`, empty strings)
  - Emit errors E001–E010 as `Diagnostic` values; return `Err` if any errors
    present
- **Test:** resolve drone + social-media + software-house examples; assert
  resolved IDs, relationships, and that deliberate W001/W002/W005 triggers are
  present

---

## Task 1 — Foundation

- Add dependencies to `Cargo.toml`: `hcl-rs`, `clap` (derive feature),
  `owo-colors`, `walkdir`, `anyhow`
- Set up module structure: `parse`, `model`, `resolve`, `validate`, `score`,
  `dot`, `cli`
- Define raw model types: `RawFile`, `Labeled<T>`, `RawProject`, `RawSystem`,
  `RawComponent`, `RawInterface`, `RawMessage`, `RawField` — all optional
  fields, no logic
- Implement `parse_file(src: &str) -> Result<RawFile>` by walking `hcl::Body`,
  handling recursive component/interface nesting
- Implement file discovery: glob all `.hcl` files in a directory, parse each,
  merge into one `RawFile`; detect E010 (multiple `project` blocks) during merge
- **Test:** parse all three example projects without error and assert field
  values on at least one
