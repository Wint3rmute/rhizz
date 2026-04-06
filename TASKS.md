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

## Task 36 — Add interactive zoom to the graph view

**Spec reference**: `SPEC/gui.md` § View Rendering (line 35).

**What the spec says**:

> The resulting node positions and edges are drawn directly onto an
> `egui::Painter` inside a `ScrollArea`, giving the user **free pan and zoom**.

**What the code does** (`crates/rhizz-gui/src/main.rs`, lines 836–861):

The view is wrapped in `egui::ScrollArea::both()` (providing pan via
scrolling), but the scale factor is computed once as an auto-fit ratio:

```rust
let scale = (avail.x / canvas.x).min(avail.y / canvas.y).min(1.0);
```

There is no interactive zoom — the user cannot zoom in or out with the mouse
wheel, pinch gesture, or buttons. The scale is read-only and fixed to
"fit in available space, max 1:1".

**Acceptance criteria**:

- Add a per-view zoom level (`f32`) to `RhizzApp` (or `GraphLayout`), defaulting
  to the current auto-fit value.
- Detect `egui::InputState::scroll_delta` (or `zoom_delta`) inside the graph
  `ScrollArea` response and update the zoom level accordingly (e.g. Ctrl+scroll
  or pinch to zoom).
- Apply the per-view zoom level as the `scale` argument to `draw_graph_layout`
  so the drawn canvas grows/shrinks interactively.
- The `ScrollArea` continues to provide panning; when zoomed in beyond the
  available area the user must be able to scroll to see all parts of the graph.
- Add reset-to-fit behaviour (e.g. double-click or a "Fit" button) that
  restores the scale to the auto-fit value.
- All existing tests continue to pass.

---

## Task 28 — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
