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
