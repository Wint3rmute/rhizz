# Implementation Tasks

How to work on this file:

- Read the next task from this file (first task not already listed in `FINISHED_TASKS.md`)
- Get extra context from recently finished tasks (read the first 50 lines of `FINISHED_TASKS.md`)
- Implement it, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED_TASKS.md` and report that you're finished

---

---

## Task 19 — Task template

- When a tab is selected, call `rhizz_dot::render_view` to get the DOT string, then pass it to the `layout` crate to compute node positions.
- Draw nodes and edges with `egui::Painter` inside a `ScrollArea` (pan via scroll, no zoom required for the prototype).
- Leaf components → solid-border box; non-leaf components → dashed-border cluster rectangle containing their children; unidirectional interface → arrow; bidirectional → plain line.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.
