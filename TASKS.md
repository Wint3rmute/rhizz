# Implementation Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of `FINISHED_TASKS.md`
- Implement the task, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED_TASKS.md` and report that you're finished

---

## Task 27 — Typed WASM wrappers for rhizz-core structs

Implement `#[wasm_bindgen]` wrapper structs in `rhizz-wasm` for the core types
the web frontend needs. Each wrapper converts from its `rhizz-core` counterpart
via a `From` impl and exposes fields as `#[wasm_bindgen(getter)]` methods so
that `wasm-pack` generates typed TypeScript class definitions.

- Remove the existing `TestStruct` / `InnerStruct` scaffolding.
- Add wrapper structs: `DiagnosticJS`, `ComponentJS`, `ScoreReportJS`,
  `CategoryScoreJS`, `ProjectJS`.
- Each wrapper derives `Clone` and implements `From<&rhizz_core::T>`.
- Expose all fields relevant to the frontend as `#[wasm_bindgen(getter)]`
  methods (strings, numbers, booleans, `Vec<primitive>`). For nested wasm_bindgen
  structs, return the wrapper type directly.
- Update `CompileResultJS` methods:
  - `diagnostics() -> Vec<DiagnosticJS>` (typed, replaces `JsValue` version)
  - `error_count() -> usize`
  - `warning_count() -> usize`
  - `components() -> Vec<ComponentJS>` (returns empty vec when model is `None`)
  - `score() -> Option<ScoreReportJS>` (calls `rhizz_core::score()`, returns
    `None` when model is `None`)
  - `project() -> Option<ProjectJS>`
- Verify `wasm-pack build --target web` succeeds and the generated `.d.ts` files
  contain the expected class definitions.
- Spec reference: `SPEC/frontend.md` § WASM Integration.

---

## Task 28 — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead