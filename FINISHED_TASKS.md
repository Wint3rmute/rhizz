# Finished Tasks

Completed tasks are listed here, most recent first.

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
