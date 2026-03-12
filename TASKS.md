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

## Task 20 — Recursive file discovery

The CLI's `load_sources` and the test helper `parse_dir` currently scan only
`max_depth(1)`. Change them to recursively discover all `.hcl` files in the
project directory tree, so that files in subdirectories (e.g.
`components/flight-controller.hcl`) are parsed and merged like any other file.

**Spec reference:** SPEC.md §1 (project structure).

### Acceptance criteria

- `load_sources` in `rhizz-cli/src/cli.rs` uses `WalkDir::new(dir)` without
  `max_depth(1)` — all `.hcl` files at any depth are collected and returned.
- `parse_dir` test helper in `rhizz-core/src/parse.rs` is updated the same way.
- `rhizz-gui` file discovery is updated the same way.
- Existing tests and examples pass unchanged (no `.hcl` files in subdirectories
  exist yet in the other examples, so behaviour is identical).
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 21 — Parse top-level `component` blocks

Allow `component` as a top-level block in `.hcl` files, alongside `system`,
`view`, and `project`. After this task, top-level components are parsed and
merged but not yet resolvable via `source`.

**Spec reference:** SPEC.md §2.3, SPEC/models.md (RawFile, parse_file, merge).

### Acceptance criteria

- `RawFile` gains a `components: Vec<Labeled<RawComponent>>` field.
- `parse_file` handles `"component"` as a top-level block identifier (calls
  the existing `parse_component` + `first_label`).
- `merge_into` concatenates `components` vecs from all files.
- A top-level `component` block in an `.hcl` file no longer produces an
  "unknown top-level block" error.
- Unit tests:
  - A file with a top-level `component` block parses successfully.
  - A file mixing `system`, `component`, and `view` blocks parses correctly.
- All existing tests pass unchanged.
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 22 — Add `source` attribute and resolve component references

Add the `source` attribute to `RawComponent` and implement resolution: when a
component inside a system (or parent component) has `source = "some-label"`,
the resolver looks up the top-level component with that label, validates
exclusivity, detects cycles, and clones the body into the sourced component
slot.

**Spec reference:** SPEC.md §2.3 (source rules), SPEC/models.md (source
resolution during resolution pass).

### Acceptance criteria

- `RawComponent` gains `source: Option<String>`.
- `ComponentAttrs` serde helper gains `source: Option<String>`.
- `parse_component` reads the `source` attribute from HCL.
- New `DiagnosticCode` variants: `E012`, `E013`, `E014` are defined and emitted:
  - E012: component with `source` has other attributes or child blocks.
  - E013: circular `source` chain detected.
  - E014: `source` references an undefined top-level component.
- During resolution, before walking a system's component tree, the resolver
  builds a `HashMap<String, RawComponent>` from `RawFile.components`.
  Duplicate top-level component labels → E001.
- When a component has `source`:
  1. Check exclusivity (E012).
  2. Look up the label in the top-level component map (E014 if missing).
  3. Check the ancestor set for cycles (E013).
  4. Clone the top-level component's body (description, tags, level, leaf,
     ports, children, connections) into the sourced slot. The label at the
     usage site is kept.
  5. Recurse into the cloned children for nested `source` references.
- Unit tests:
  - Component with `source` pointing to a valid top-level component → body
    cloned correctly, resolved model is identical to inline definition.
  - Component with `source` + inline `description` → E012.
  - Component with `source` pointing to undefined label → E014.
  - Circular `source` (A sources B, B sources A) → E013.
  - Nested `source` (A sources B, B has child that sources C) → works.
  - Same top-level component sourced into two different systems → works.
- The drone example (`examples/drone/`) compiles correctly with the
  `flight-controller` sourced from `components/flight-controller.hcl`.
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 23 — W012: orphan top-level component warning

Detect top-level components that are not referenced by any `source` attribute
anywhere in the model and emit warning W012.

**Spec reference:** SPEC.md §4.2 (W012).

### Acceptance criteria

- New `DiagnosticCode::W012` is defined.
- After resolving all systems and expanding all `source` references, the
  resolver tracks which top-level component labels were actually used.
  Any unused labels produce W012.
- Unit tests:
  - A top-level component referenced by `source` → no W012.
  - A top-level component not referenced by any `source` → W012.
  - A top-level component referenced multiple times → no W012.
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 24 — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead