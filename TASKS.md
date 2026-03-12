# Implementation Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of `FINISHED_TASKS.md`
- Implement the task, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED_TASKS.md` and report that you're finished

---

## Task 22 — Add `source` attribute and resolve component references

Add the `source` attribute to `RawComponent` and implement resolution: when a
component inside a system (or parent component) has `source = "some-label"`,
the resolver looks up the top-level component with that label, validates
exclusivity, detects cycles, and clones the body into the sourced component
slot.

**Spec reference:** SPEC.md §2.3 (source rules), SPEC/models.md (source
resolution during resolution pass).

**Important:** do NOT modify any existing example `.hcl` files in this task.
Write unit tests that exercise `source` with inline HCL strings. The drone
example update is Task 23.

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
- Unit tests (all using inline HCL strings — no example file changes):
  - Component with `source` pointing to a valid top-level component → body
    cloned correctly, resolved model is identical to inline definition.
  - Component with `source` + inline `description` → E012.
  - Component with `source` pointing to undefined label → E014.
  - Circular `source` (A sources B, B sources A) → E013.
  - Nested `source` (A sources B, B has child that sources C) → works.
  - Same top-level component sourced into two different systems → works.
- All existing tests continue to pass.
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 23 — Update drone example to use `source`

Now that all the infrastructure is in place (Tasks 20–22), update the drone
example to demonstrate the feature end-to-end.

**Spec reference:** SPEC.md §2.3.

### Acceptance criteria

- In `examples/drone/systems.hcl`, replace the inline `flight-controller`
  component (approx 120 lines of ports, children, connections) with:
  ```hcl
  component "flight-controller" {
    source = "flight-controller"
  }
  ```
- `examples/drone/components/flight-controller.hcl` already exists as a
  top-level `component "flight-controller" { … }` with the full body. Verify
  it matches the removed inline definition (same ports, children, connections).
- `examples/drone/README.md` is updated to mention the `source` feature and
  list the `components/flight-controller.hcl` file.
- All integration tests that compile the drone example pass — the resolved
  model must be identical (same components, ports, connections, messages,
  scores, views) to the previous inline version.
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 24 — W012: orphan top-level component warning

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
- All existing tests continue to pass (no orphan top-level components exist
  in the examples after Task 23).
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

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