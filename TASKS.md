# Implementation Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of
  `FINISHED_TASKS.md`
- Implement the task, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`)
  until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED_TASKS.md` and report that you're finished

---

## Task 37 — Add unit tests for the extracted geometry module (continued)

Task 36 (extraction) is done, and the test harness (Vitest, via
`deno task test`) is scaffolded with initial tests for `boxCenter`,
`boxContains`, and `clampWithin` in
`web/src/routes/diagrams/geometry.test.ts`. Remaining work:

- `elbowPath` — both orientations, including the straight-line shortcuts
  and the sweep-flag reflection for the vertical variant. Consider
  `@std/testing/snapshot`-style snapshotting (or Vitest's own
  `toMatchSnapshot`) rather than hand-written string literals, since exact
  path strings are brittle to assert on directly.
- `boxBoundaryPoint` — all four side choices, including axis-aligned edge
  cases (dx or dy exactly 0).
- `clampResizeWithin` — within bounds unchanged; exceeds right/bottom edge
  → capped; capped result still respects `MIN_NODE_SIZE`.
- `unionBox` — single box; multiple scattered boxes; decide what to do
  about the empty-array case (currently `Math.min()`/`Math.max()` with no
  args returns `±Infinity` — likely worth a guard/fix while adding the
  test).
- `depthOf` — root component → 0; nested chain → correct hop count; no
  parent → 0.
- `textPosition` — exact x/y/anchor/baseline per alignment case (not yet
  covered).
- Validate with `deno task test`.

---

## Task 38 — Replace ad hoc interaction state with a discriminated-union state machine

`dragging`, `resizing`, `panning`, and `marquee` are four independently
nullable state variables in `web/src/routes/diagrams/+page.svelte`,
checked in sequence across `onNodeMouseDown`/`onCanvasMouseDown`/
`onResizeHandleMouseDown`/`onSvgMouseMove`/`onSvgMouseUp`. Nothing enforces
that at most one is active at a time other than convention — the codebase
used to have a proper discriminated-union `EditorState` for this
(`idle | moving_canvas | zooming` in `ViewEditorState.svelte`) before it
was removed in favor of these separate flags.

- Replace the four separate variables with one
  `interaction: {type: "idle"} | {type: "dragging", ...} | {type: "resizing", ...} | {type: "panning", ...} | {type: "marquee", ...}`
  state.
- Update all five handler functions to read/write this single state via
  exhaustive `switch`/discriminant checks instead of independent `if`
  chains.
- End-to-end result: no behavior change, but adding a future interaction
  mode only requires extending one union type instead of adding another
  parallel nullable variable.
- Validate with `deno task check` and `deno task build`.

---

## Task 39 — Make diagram layout persistence keys stable across HCL source edits

`checked`/`savedLayout` are keyed by a component's arena index (its
position in `model.components()`), which is derived from HCL parse order.
Reordering or inserting components earlier in the source file silently
reattaches persisted positions to the wrong component on reload.

- Design and implement a structurally stable key (e.g. a path built from
  the chain of parent labels down to the component, such as
  `"controller/mcu"`), replacing the raw arena index as the storage key for
  both `checked` and `savedLayout`.
- Handle the migration path for existing persisted data under the old
  arena-index keys (either a one-time migration or accept that old
  layouts reset once, clearly documented).
- Validate with `deno task check` and `deno task build`, and manually
  verify that reordering components in the HCL source no longer scrambles
  persisted positions.

---

## Task 40 — Make the diagram view (pan/zoom) page-scoped instead of a module-level singleton

`ViewEditorState.svelte`'s `editor_state` (pan/zoom) is a module-level
singleton shared by every consumer of `get_editor_state()`. This was
flagged early in the diagrams work and never revisited; every other piece
of diagrams state added since is properly component-scoped.

- Refactor so the diagrams page owns its own view state instance (e.g. via
  context, or constructed locally and passed down), rather than a shared
  global.
- Confirm this doesn't regress the current single-instance case while
  unblocking any future multi-instance use (split view, thumbnail
  preview, etc.).
- Validate with `deno task check` and `deno task build`.

---

## Task 41 — Replace plain Set with SvelteSet for the selection state

`selected` (in `web/src/routes/diagrams/+page.svelte`) is a plain
`Set<number>` wrapped in `$state`, which requires always reassigning a
fresh `Set` on every change (documented via comments) since plain `Set`
mutations aren't deeply tracked by Svelte's `$state`. This is a footgun
for future contributors who might call `.add()`/`.delete()` directly and
get a silent no-op.

- Replace with `SvelteSet` from `svelte/reactivity`, which supports direct
  mutation.
- Simplify call sites that currently reconstruct a new `Set` purely to
  satisfy reactivity.
- Validate with `deno task check` and `deno task build`.

---

## Task 42 — Deduplicate drag/resize coordinate-and-clamp logic in the diagrams canvas

Small/polish item from the architecture review.

The drag and resize branches of `onSvgMouseMove` (and their single-vs-group
variants) repeat a similar shape — get pointer coordinates, compute a
proposed box, optionally clamp against an active parent, write via
`setNodeBox`, cascade to children — with small variations that have
drifted apart slightly across several iterations.

- Extract the shared shape into one or more helper functions so the
  single/group drag and resize paths share logic instead of parallel,
  slightly-diverging implementations.
- No behavior change.
- Validate with `deno task check` and `deno task build`.

---

## Task 43 — Add schema validation for persisted diagram localStorage data

Small/polish item from the architecture review.

`nodeBox()` backfills *missing* fields on `checked`/`savedLayout` entries,
but there's no validation that persisted `localStorage` data is
well-formed at all. A corrupted or manually-edited entry (or a future
schema change) could propagate `NaN`/`undefined` into the geometry math
with no guardrail.

- Add lightweight runtime validation (e.g. a schema-check function, or a
  small validation library if one is already justified elsewhere in the
  project) when reading persisted diagram state, discarding/ignoring
  malformed entries instead of letting them propagate.
- Validate with `deno task check` and `deno task build`.

---

## Task 44 — Make diagram tuning constants configurable

Small/polish item from the architecture review.

Constants like `SNAP_GRID_SIZE`, `MIN_NODE_SIZE`, `ZOOM_TO_FILL_FRACTION`,
`CHILD_CONTAINMENT_MARGIN`, and `TEXT_ALIGN_PADDING` are hardcoded in
`web/src/routes/diagrams/+page.svelte`, despite earlier discussion
anticipating some of these becoming user-configurable.

- Design a small settings mechanism (persisted, page-scoped) for at least
  `SNAP_GRID_SIZE`, since that one was explicitly called out as likely to
  need this.
- Add UI for adjusting it (e.g. in the existing bottom-right button row or
  the inspector panel).
- Validate with `deno task check` and `deno task build`.

---

## Task 45 — Extend containment clamping to grandchildren (multi-level nesting)

Small/polish item from the architecture review. Mirrors the scope note
from the previously-postponed containment-polish task, re-added here for
visibility.

Containment clamping only considers a node's *direct* parent. If
`A ⊃ B ⊃ C` are all placed on canvas, `C` clamps to `B` but not
transitively to `A`.

- Decide and implement how deep the clamping should cascade (likely:
  transitively clamp through the whole ancestor chain, not just the
  direct parent).
- Validate with `deno task check` and `deno task build`.

---

## Task 46 — Enforce containment during group-resize

Small/polish item from the architecture review.

Group-resize (proportional scaling of a multi-selection) does not enforce
parent containment at all, unlike single-node resize. This is a known,
documented gap from when group-resize was implemented.

- Decide on a reasonable behavior when a group-resize would push a
  constrained child outside its parent (e.g. cap the group scale factor to
  the most restrictive member, or clamp each affected child individually
  after the scale is applied).
- Validate with `deno task check` and `deno task build`.

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
