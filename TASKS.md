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

**Implementation plan:** Add a `validateStoredBox(value: unknown):
StoredBox | null` function that checks `x`/`y` are finite numbers, that
`width`/`height` (if present) are finite numbers, and that `textAlign` (if
present) is one of the three `TextAlign` literals, returning `null` for
anything else; wrap it in a `sanitizeStoredRecord(record: unknown):
Record<string, StoredBox>` that filters a raw parsed object through it,
dropping invalid entries (with a `console.warn` naming the dropped keys,
so corruption isn't totally silent during development).

Apply this at load time only, right where `stripLegacyIndexKeys` already
runs on `checked.value`/`savedLayout.value` (chain it as
`sanitizeStoredRecord(stripLegacyIndexKeys(...))`), so every other
read/write site (`nodeBox()`, `setNodeBox()`, ...) can keep trusting that
anything already in `checked.value` is well-formed, with no validation
sprinkled into the hot drag/resize path. Extract
`validateStoredBox`/`sanitizeStoredRecord` into a plain, Svelte-free
function (e.g. alongside `geometry.ts` or a new small `persistence.ts`)
so they can get direct Vitest coverage the same way `geometry.ts` does,
rather than only being exercised indirectly through the component.

No behavior change for well-formed data — this is purely a guardrail for
corrupted/hand-edited `localStorage` entries or future schema drift.
Validate with `deno task check`, `deno task build`, and `deno task test`.

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

**Implementation plan:** Scope to `SNAP_GRID_SIZE` only, as the task
prioritizes — leave `MIN_NODE_SIZE`, `ZOOM_TO_FILL_FRACTION`,
`CHILD_CONTAINMENT_MARGIN`, and `TEXT_ALIGN_PADDING` hardcoded until a
concrete need for exposing them shows up (avoids speculative settings UI).
Replace `const SNAP_GRID_SIZE = 10;` with a persisted, page-scoped value
via the existing `persisted()` helper (the same one already backing
`checked`/`savedLayout`/`input`), e.g. `let snapGridSize =
persisted("DIAGRAM_SNAP_GRID_SIZE", 10);`, and update `snap()` to read
`snapGridSize.value` instead of the constant.

Add a minimal control next to the existing "Snap to Grid" button in the
bottom-right button row — a small numeric input or a `+`/`-` stepper pair,
clamped to a sane range (e.g. 1–100) — rather than building a general
settings panel for a single value. Update the button's tooltip to
interpolate the live `snapGridSize.value` instead of the old constant.

Validate with `deno task check` and `deno task build`, and manually
confirm the chosen grid size persists across a page reload.

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

**Implementation plan:** The fix belongs in `reclampChildren(parentIndex)`
— today it clamps only `parentIndex`'s *direct* children against
`parentIndex`'s box. Make it recurse: after clamping each direct child,
call `reclampChildren(childIndex)` again so grandchildren (and deeper) get
re-clamped against their own just-updated parent, cascading all the way
down. Since `reclampChildren` already bails out early for any component
not currently placed on canvas, the recursion is naturally bounded by
what's actually on-screen — no separate depth limit needed.

`activeParentBox` and the per-node clamp during a drag/single resize
(which only clamp a node against its *immediate* active parent) don't
need to change — that's still correct on its own, since a node should
always stay within its direct parent regardless of nesting depth. The
transitive part is entirely handled by `reclampChildren`'s cascade once a
middle ancestor's box changes, so this task is essentially a one-function
fix plus verification.

This is UI-interaction-driven and not easily covered by the existing pure
geometry unit tests, so validate manually in the browser: place a 3-level
`A ⊃ B ⊃ C` hierarchy, drag `A` far enough that `B` has to clamp, and
confirm `C` is re-clamped to follow. Validate with `deno task check` and
`deno task build`, and update `reclampChildren`'s doc comment (which
currently says "direct child") to describe the new transitive behavior.

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

**Implementation plan:** Clamp each affected child individually after the
group scale is applied, rather than solving for one "safe" group scale
factor upfront (which would need a constraint-solving pass over every
constrained member — unnecessary complexity at this project's stage).
Concretely: in `applyGroupScale`'s loop, after computing each node's
scaled `next` box as it does today, check `activeParentBox(index)`; if
present, clamp `next` through `clampWithin(next, parentBox,
CHILD_CONTAINMENT_MARGIN)` (the same helper `applyGroupDelta` already uses)
before calling `setNodeBox`. Nodes without an active parent are
unaffected.

This brings resize in line with the containment guarantee drag already
provides, at the cost of the group occasionally no longer looking like a
perfectly uniform scale when some members are constrained and others
aren't — an accepted trade-off, mirroring the one `applyGroupDelta`
already documents ("the group may not move perfectly rigidly, but no node
is ever allowed to escape its parent's box"). Once both `applyGroupDelta`
and `applyGroupScale` do the same "compute proposed box, then clamp
against own active parent if present" step, consider factoring that check
into one small shared helper.

Validate with `deno task check` and `deno task build`, and manually verify
by nesting a component, selecting a group that includes it alongside
other nodes, and resizing the group.

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
