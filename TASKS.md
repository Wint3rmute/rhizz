# Implementation Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of `FINISHED_TASKS.md`
- Implement the task, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED_TASKS.md` and report that you're finished

---

## Task 19 — Replace custom RenderBackend with SVG rasterization in rhizz-gui

The current `EguiBackend` (`RenderBackend` impl, ~300 lines) re-implements primitive
drawing on top of `layout-rs` internals. Replace it with `layout-rs`'s built-in SVG
output rasterized by `resvg` + `tiny-skia`, displayed as an `egui::ColorImage` texture.

### Acceptance criteria

- Add `resvg` and `tiny-skia` as dependencies to `rhizz-gui/Cargo.toml`.
- Remove `EguiBackend`, `DrawCmd`, `GraphLayout`, `draw_graph_layout`,
  `scale_and_offset_rect`, `draw_edge`, `draw_arrowhead`, `draw_dashed_line`,
  `draw_dashed_rect`, and `offset_rect` (all custom drawing code).
- `compute_graph_layout` is replaced by `render_view_to_image(model, view, size: Vec2) -> Result<egui::ColorImage, String>`:
  - Calls `rhizz_dot::render_view` to get the DOT string.
  - Passes it to `layout-rs` SVG backend to get an SVG string.
  - Rasterizes the SVG at the given pixel dimensions using `resvg`.
  - Returns an `egui::ColorImage` (RGBA).
- `RhizzApp` stores a `Vec<Option<(egui::TextureHandle, egui::Vec2)>>` (one slot per
  view) instead of `view_layouts`. The `egui::Vec2` records the panel size at which the
  texture was last rendered, so it can be compared against current available size.
- In the `update` loop, if the available panel size differs from the stored size by more
  than 4 px on either axis, re-rasterize and upload a new texture.
- The texture is displayed with `ui.image(texture, available_size)` inside a
  `ScrollArea` (no manual coordinate math).
- All existing GUI tests (`is_hcl_event`, `is_bidirectional_connection`, layout smoke
  tests) are updated or replaced; at minimum one test per example project verifies that
  `render_view_to_image` returns `Ok` with a non-empty image.
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 20 — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead