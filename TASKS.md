# Implementation Tasks

How to work on this file:

- Read the next task
- Implement it, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Delete the task from the file once done, report that you're finished

---

## Task 11 - `watch` command for rhizz-cli

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

## Task 12 - Task template

Use this template when creating new tasks. Keep on increasing the task number!