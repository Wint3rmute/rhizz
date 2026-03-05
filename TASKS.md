# TODO

How to work on this file:

- Read the next task from the `# TODO` section (first level-2 header below)
- Get extra context from recently finished tasks in the `# FINISHED` section
- Implement it, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to the top of the `# FINISHED` section

## Task 12 — Scaffold `rhizz-gui` crate

Add `crates/rhizz-gui` to the Cargo workspace as a new binary crate.

- Add `rhizz-gui` to the `members` list in the root `Cargo.toml`.
- Create `crates/rhizz-gui/Cargo.toml` with dependencies: `eframe`, `egui`, `rhizz-core`, `rhizz-dot`, `notify`, `walkdir`, `anyhow`.
- `src/main.rs` accepts a single positional CLI argument — a path to a project directory — and opens a blank `eframe` window titled "rhizz" with the path shown in the title bar.
- No model logic yet; the window just needs to open without panicking.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 13 — Startup load + diagnostic pane

On launch, read all `.hcl` files from the project directory argument, call `rhizz_core::compile`, and display results in the window.

- A scrollable bottom pane lists every diagnostic (`code`, `file`, `line`, `message`); errors in red, warnings in yellow.
- A left sidebar lists every system, component, and interface by name (flat list is fine).
- No watcher yet — compile once at startup and display the static result.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 14 — File watcher + live recompile

Register a `notify` watcher on the project directory. Recompile and refresh all panels on any `.hcl` change.

- Use the same `notify` + `mpsc` + debounce pattern as `rhizz-cli`'s `watch` command (200 ms debounce).
- Keep the last successfully resolved `Model` in memory. If the new compile has hard errors, show the new diagnostics but continue rendering the previous valid model everywhere else.
- A small status bar at the bottom shows either "OK" or "X errors, Y warnings" after each recompile.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 15 — View tabs with `layout-rs` rendering

For each view in the model, show a tab at the top of the main area.

- When a tab is selected, call `rhizz_dot::render_view` to get the DOT string, then pass it to the `layout` crate to compute node positions.
- Draw nodes and edges with `egui::Painter` inside a `ScrollArea` (pan via scroll, no zoom required for the prototype).
- Leaf components → solid-border box; non-leaf components → dashed-border cluster rectangle containing their children; unidirectional interface → arrow; bidirectional → plain line.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 16 — Score dashboard panel

Add a collapsible right panel showing the completion score.

- Call `rhizz_core::score` on the current model and display the `ScoreReport` as a table: one row each for Components, Interfaces, and Messages showing `complete / total (x%)`.
- Below the table, show the overall percentage as a filled progress bar.
- The panel refreshes automatically on every recompile.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 17 — Task template

Use this template when creating new tasks. Keep on increasing the task number!

---

# FINISHED

## Task 11 — `watch` command for rhizz-cli

Add a `rhizz watch <path>` command to `rhizz-cli` that behaves identically to `rhizz build` but reruns the full build pipeline automatically whenever any `.hcl` file in the project directory changes.

### Acceptance Criteria

- `rhizz watch <path>` performs the same pipeline as `rhizz build` (parse → validate → score → views) on startup, then sits in a loop waiting for file-system events.
- On any create, modify, or delete event for a `.hcl` file under `<path>`, the pipeline is rerun from scratch and the output is reprinted.
- Use the [`notify`](https://crates.io/crates/notify) crate (cross-platform; wraps `inotify` on Linux, `FSEvents` on macOS, `ReadDirectoryChangesW` on Windows) — **not** the `inotify` crate directly, so the feature works on macOS and Windows too.
- A short debounce period (e.g. 200 ms) prevents re-running the pipeline multiple times for a single logical save that produces several rapid events.
- The command can be interrupted cleanly with Ctrl-C (SIGINT); on exit it prints a short "Stopped watching." message and exits with code 0.
- All existing flags (`--strict`, `--json`, `--output-dir`, `--no-color`) are forwarded to the inner build pipeline exactly as they are for `rhizz build`.
- The `notify` dependency must be added only to `rhizz-cli/Cargo.toml`, not to `rhizz-core` or `rhizz-dot`.

### Implementation Notes

- Add `Watch` variant to the existing `Command` enum in `cli.rs`, with the same arguments as `Build`.
- Extract (or reuse) the existing `run_build` helper so both `build` and `watch` call it.
- The watch loop should live in a new function `run_watch` in `cli.rs` (or a new `watch.rs` module if you prefer).
- Use `notify::recommended_watcher` with a `std::sync::mpsc` channel; filter received events to `.hcl` extension before triggering a rebuild.
- Print a clear "Watching <path> for changes…" banner before the initial build so the user knows the watcher is active.

### Tests

- Integration test: spawn `rhizz watch` against one of the `examples/` directories, modify an `.hcl` file, and assert that the command prints the build output a second time.  Use a timeout to avoid hanging CI.
- Unit test: verify the debounce logic does not trigger multiple rebuilds for events arriving within the debounce window.

---

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

---

## Task 9 — Establish `rhizz-dot`

Move `dot.rs` into `crates/rhizz-dot/src/`.
Expose `fn render_view(model: &Model, view: &View) -> String`.
Add `rhizz-core` as a path dependency.
No I/O. All pre-existing tests travel with the module.

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

---

## Task 7 — Convert root to a Cargo workspace

Replace the root `Cargo.toml` `[package]` section with a `[workspace]` manifest that lists `crates/rhizz-core`, `crates/rhizz-dot`, and `crates/rhizz-cli` as members.
Create the three `crates/` subdirectories, each with a skeleton `Cargo.toml` and empty `src/lib.rs` (or `src/main.rs` for the CLI).
Verify that `cargo build` succeeds on the empty workspace.

---

## Task 6 — CLI

- Implement `clap` arg parser as specified in `SPEC/cli.md`: `check`, `score`, `views`, `build` subcommands; default to `build`
- Implement human-readable diagnostic output: `✗ E002  file.hcl:14  message` / `⚠ W001 ...`
- Implement `--json` output mode with the schema from `SPEC/cli.md`
- Implement `--strict` (warnings → errors), `--no-color`, `NO_COLOR` env var, non-TTY detection
- Wire exit codes: `0` on success, `1` on errors (or warnings under `--strict`)
- **Test:** run `rhizz build` on each example, assert exit code and stdout content

---

## Task 5 — Graphviz DOT Generation

- Implement `render_view(model: &Model, view: &View) -> String`
- Apply filter predicates: tag inclusion/exclusion, `max_level`, component whitelist, `show_messages`
- Emit `subgraph cluster_*` for non-leaf components, box nodes for leaf components
- Emit directed/undirected edges for interfaces; include message names in edge labels when `show_messages = true`
- Write rendered `.dot` files to `--output-dir`
- **Test:** render all views in each example; assert output contains expected node/edge identifiers

---

## Task 4 — Completion Scoring

- Implement `score(model: &Model) -> ScoreReport` with the per-entity 0.0/0.5/1.0 logic from SPEC.md §5
- Produce per-category counts (components/interfaces/messages) and overall aggregate
- Implement `ScoreReport` display formatting matching the spec output format
- **Test:** assert score values for each example match hand-calculated expectations

---

## Task 3 — Validation and Warnings

- Implement a warning pass over the resolved `Model`, emitting W001–W007 as non-blocking `Diagnostic` values
- Implement `Diagnostic` type with fields: `code`, `file`, `line` (optional), `message`
- **Test:** assert that each example emits exactly the expected warning codes and none of the examples produce unexpected errors

---

## Task 2 — Resolution

- Define resolved model types and newtyped ID structs (`ComponentId`, `InterfaceId`, etc.) and the full `Model` arena as described in `SPEC/models.md`
- Implement `resolve(raw: RawFile) -> Result<(Model, Vec<Diagnostic>), Vec<Diagnostic>>`:
  - Walk raw tree depth-first, allocate IDs, populate arenas
  - Build `ScopeIndex` mapping `(Scope, label) → id` for components and interfaces
  - Resolve `from`/`to` and `encapsulates` references via scope lookup
  - Apply all defaults (`level` auto-increment, `leaf = false`, empty strings)
  - Emit errors E001–E010 as `Diagnostic` values; return `Err` if any errors present
- **Test:** resolve drone + social-media + software-house examples; assert resolved IDs, relationships, and that deliberate W001/W002/W005 triggers are present

---

## Task 1 — Foundation

- Add dependencies to `Cargo.toml`: `hcl-rs`, `clap` (derive feature), `owo-colors`, `walkdir`, `anyhow`
- Set up module structure: `parse`, `model`, `resolve`, `validate`, `score`, `dot`, `cli`
- Define raw model types: `RawFile`, `Labeled<T>`, `RawProject`, `RawSystem`, `RawComponent`, `RawInterface`, `RawMessage`, `RawField` — all optional fields, no logic
- Implement `parse_file(src: &str) -> Result<RawFile>` by walking `hcl::Body`, handling recursive component/interface nesting
- Implement file discovery: glob all `.hcl` files in a directory, parse each, merge into one `RawFile`; detect E010 (multiple `project` blocks) during merge
- **Test:** parse all three example projects without error and assert field values on at least one