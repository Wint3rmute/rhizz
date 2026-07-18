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
