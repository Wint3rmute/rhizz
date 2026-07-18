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

## Task 31 — Add resizable size to diagram nodes (data model)

- Extend the per-node persisted record from `{x, y}` to
  `{x, y, width, height}`, defaulting to `100x100` to match current visuals.
- Defensively backfill old persisted entries that lack `width`/`height` when
  loading from `localStorage`.
- Render nodes with dynamic `width`/`height` instead of the hardcoded
  `"100"`/`"100"`; recompute `nodeCenter` from actual size instead of the
  fixed `+50` offset.
- End-to-end result: no visible/behavioral change yet, but the data model now
  supports variable node size — unblocks Task 32.
- Validate with `deno task check` and `deno task build`.

---

## Task 32 — Add corner-drag resize interaction for the selected node

- Render a small resize handle at the bottom-right corner of the selected
  node only (hidden otherwise).
- Add a `resizing` interaction state that mirrors the existing
  `dragging`/`panning` pattern in `+page.svelte`; update `width`/`height` on
  drag with a sane minimum size (e.g. `40x40`).
- End-to-end result: select a node, drag its corner, it resizes and the new
  size persists across reload.
- Validate with `deno task check` and `deno task build`.

---

## Task 33 — Add left-side inspector panel for the selected node

- Add a new left sidebar (mirroring the existing right sidebar's structure
  and styling) shown only when `selected !== null`.
- For now, show the selected component's label/description as a header —
  an empty shell ready for style controls added in Task 34.
- End-to-end result: selecting a node opens the panel; deselecting closes it.
- Validate with `deno task check` and `deno task build`.

---

## Task 34 — Add text alignment control to the node inspector

- Extend the per-node record (from Task 31) with
  `textAlign: "center" | "top-center" | "top-left"`, defaulting to
  `"center"`.
- Add a 3-button segmented control to the inspector panel (Task 33), bound
  to the selected node's `textAlign`.
- Map `textAlign` to the label `<text>` element's `x`/`y`/`text-anchor`/
  `dominant-baseline`, with small fixed padding for the two top-aligned
  variants.
- End-to-end result: select a node, change alignment, the label repositions
  live inside the box and persists across reload.
- Validate with `deno task check` and `deno task build`.

---

## Task 35 — Enforce parent/child containment constraints on the canvas

Builds on Task 29 (index-keyed canvas state) and `ComponentJS.parent_component_index`
(already exposed by `rhizz-wasm`).

- A node "has an active parent" iff its `parent_component_index` is also a
  key currently present in the canvas state.
- Add a pure `clampWithin(childBox, parentBox, margin)` helper that clamps
  the child's position (and shrinks its size if needed) so its full box
  stays inside the parent's box.
- Apply the clamp:
  - Live during child drag (not just on drop) whenever its parent is present
    on canvas.
  - After child resize.
  - On initial placement — checking a child whose parent is already placed
    drops it clamped inside the parent, instead of the current blind
    `(100, 100)` default.
  - Cascading — moving or resizing a parent re-clamps all of its currently
    placed children afterward.
- Ensure paint order puts parents before children (sort by hierarchy depth)
  so children visually sit on top of their parent's box instead of being
  obscured by it.
- End-to-end result: place a composite component and one of its children on
  canvas — dragging/resizing the child is bounded to the parent's box;
  moving/resizing the parent carries the constraint region with it.
- Validate with `deno task check` and `deno task build`.

---

## Task 36 — Containment polish and documented scope boundaries

- If a parent is resized smaller than a child already inside it, re-clamp/
  shrink the child to fit.
- Explicitly out of scope for this task (document as code comments where
  relevant, do not implement):
  - Overlap avoidance between sibling children — containment only.
  - Deep/transitive clamping across more than one level (grandchildren):
    if `A ⊃ B ⊃ C` are all on canvas, `C` clamps to `B` only, not to `A`.
- Validate with `deno task check` and `deno task build`.

---

## Task 28 — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
