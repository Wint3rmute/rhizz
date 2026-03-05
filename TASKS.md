# Implementation Tasks

How to work on this file:

- Read the next task
- Implement it, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Delete the task from the file once done, report that you're finished

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