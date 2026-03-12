# Implementation Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of `FINISHED_TASKS.md`
- Implement the task, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED_TASKS.md` and report that you're finished

---

## Task 25 — Attach diagnostic Markdown to `DiagnosticCode` via `include_str!`

Use `#[doc = include_str!(...)]` on each `DiagnosticCode` const to pull the
long description from the corresponding `SPEC/diagnostics/*.md` file. Remove
the hand-written one-liner doc comments that are now redundant.

**Spec reference:** SPEC/diagnostics/*.md (created in Task 25).

### Acceptance criteria

- Every `DiagnosticCode` const (`E000`–`E011`, `W000`–`W011`) has
  `#[doc = include_str!("../../../../SPEC/diagnostics/Xxxx.md")]` instead of a
  hand-written doc comment.
- `cargo doc` generates documentation that includes the full markdown content
  (description, HCL examples) for each code.
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 26 — Replace SPEC.md §4 tables with a pointer to `SPEC/diagnostics/`

Remove the error and warning tables from SPEC.md §4.1 and §4.2 and replace
them with a reference to the `SPEC/diagnostics/` folder. The section should
state that each code is documented in its own file and list the folder path.

### Acceptance criteria

- SPEC.md §4.1 and §4.2 no longer contain the per-code tables.
- §4 includes a note such as:
  "Each diagnostic code is documented in its own file under
  `SPEC/diagnostics/` (e.g. `E001.md`, `W003.md`). Error codes (`Exxx`)
  halt compilation; warning codes (`Wxxx`) are non-blocking."
- The rest of SPEC.md is unchanged.
- No code changes in this task.

---

## Task 27 — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead