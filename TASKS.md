# Implementation Tasks

How to work on this file:

- Read the next task
- Implement it, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Delete the task from the file once done, report that you're finished

---

## Task 8 — Establish `rhizz-core`

Move `model.rs`, `parse.rs`, `resolve.rs`, `validate.rs`, and `score.rs` from `src/` into `crates/rhizz-core/src/`.
Expose a clean public API:
- `Source { filename: String, content: String }`
- `CompileResult { model: Option<Model>, diagnostics: Vec<Diagnostic> }`
- `fn compile(sources: &[Source]) -> CompileResult`
- `fn score(model: &Model) -> ScoreReport`

All public types must derive `Clone`, `serde::Serialize`, and `serde::Deserialize`.
The crate must have **no** `std::fs`, `std::env`, or any I/O dependency.
All pre-existing unit tests travel with their modules; they must pass under the new crate.

## Task 9 — Establish `rhizz-dot`

Move `dot.rs` into `crates/rhizz-dot/src/`.
Expose `fn render_view(model: &Model, view: &View) -> String`.
Add `rhizz-core` as a path dependency.
No I/O. All pre-existing tests travel with the module.

## Task 10 — Migrate CLI into `rhizz-cli`

Move `cli.rs` and the `main.rs` entry point into `crates/rhizz-cli/src/`.
Add `rhizz-core` and `rhizz-dot` as path dependencies.
The CLI crate must contain no parsing, validation, scoring, or DOT-rendering logic of its own — all calls delegate to the two library crates.
Move integration tests (examples: drone, social-media, software-house) to `crates/rhizz-cli/tests/`.
Verify that the `rhizz` binary behaviour is identical to before.

Then:

Delete the old `src/` directory at the repo root once all code has migrated.
Run `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc --all`, and `cargo build --all`.
Fix any warnings or errors surfaced.
Run `cargo fmt --all`.


## Task 11 - Task template

Use this template when creating new tasks. Keep on increasing the task number!