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

## Task 29 — Fix `show_messages` default: spec says `true`, code defaults to `false`

The `view` filter block's `show_messages` attribute has a default mismatch between the spec and the implementation.

**Spec reference:** SPEC.md §2 HCL Schema, `filter` sub-block table (line ~342):
> `show_messages` | bool | no | **`true`** | Whether to list messages (from connected ports) as connection edge labels

**Mismatch:** `crates/rhizz-core/src/resolve.rs` line ~833 uses `unwrap_or(false)` instead of `unwrap_or(true)`.

**Acceptance criteria:**

- Change `f.show_messages.unwrap_or(false)` to `f.show_messages.unwrap_or(true)` in
  `crates/rhizz-core/src/resolve.rs` (`resolve_view`).
- Add a unit test (in `resolve.rs` or an integration test) that creates a `view` without
  an explicit `show_messages` attribute and asserts `filter.show_messages == true`.
- Verify that examples using `show_messages = false` still render without messages on
  edges (i.e. existing explicit `false` overrides the default correctly).
- `cargo test --all` passes; no regressions.

---

## Task 28 — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
