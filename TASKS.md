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

## Task 76 — Install FontAwesome icons, use them in the FileTree

- Install FontAwesome icons via deno
- Use the `free-solid-svg-icons` variant
  - In general, pick the most minimal and free variant
- Use the icons in the FileTree - one icon for a folder, another icon for a file

---

## Task 79 — `rhizz-core`: Locality of port verification & completion scoring for protocols

- Update port verification in `crates/rhizz-core/src/validate.rs` and `resolve.rs`:
  - **In isolation (top-level components):** Unconnected `external = true` ports do not trigger `W010`. Unconnected `external = false` ports emit `W010`.
  - **In system instantiation (in-system components):** Unconnected `external = true, required = true` ports emit `W010`.
  - Detect orphan top-level protocols not referenced by any port, emitting `W012`.
- Update completion scoring in `crates/rhizz-core/src/score.rs`:
  - Ports referencing a protocol inherit that protocol's messages for completeness scoring (score 1.0 if protocol messages are complete).
  - Top-level protocol messages are scored under the `Messages` category.
- Add unit tests in `validate.rs` and `score.rs`.
- Validate with `just test`, `just lint`, `just format`.

---

## Task 80 — `rhizz-core`: HCL serialization for protocols and port attributes

- Update bidirectional HCL serializer in `crates/rhizz-core/src/serialize.rs`:
  - Serialize top-level `protocol` blocks with description, tags, roles, and child messages/fields.
  - Serialize `external = true` and `required = false` attributes on `port` blocks.
- Add round-trip tests (parse -> resolve -> serialize -> parse) in `serialize.rs`.
- Validate with `just test`, `just lint`, `just format`.

---

## Task 81 — `rhizz-wasm`: Export protocol types and updated port metadata to JavaScript

- Update `crates/rhizz-wasm/src/lib.rs`:
  - Add `ProtocolJS` wrapper exposing `label`, `description`, `tags`, and `roles`.
  - Expose `protocols` list getter on `ModelJS`.
  - Add `external` and `required` boolean getters on `PortJS`.
- Update WASM integration tests in `crates/rhizz-wasm/tests/wasm_test.rs`.
- Validate with `just test`, `just lint`, `just format`, `just build`.

---

## Task 82 — `web`: Update frontend TypeScript types and worked examples

- Update TypeScript types in `web/src/rhizz_wasm_wrapper.ts` and VFS compiler wrappers to handle `protocols` and new port attributes.
- Update worked examples under `examples/` (`examples/drone`, `examples/social-media`, `examples/software-house`) to showcase `protocol` blocks, `external = true` boundary ports, and LCA connection placement.
- Verify all web unit tests and Svelte type-checking pass (`deno run test`, `deno task check`).
- Validate with `just test`, `just lint`, `just format`, `just build`.

---

## (For later brainstorming) Task <N> - relax requirements regarding adding new connections

This is not well understood by me at this point, but interactive experimentation with rhizz shows that it's kinda hard to "just add a new connection and have it show up on the diagram". Lots of boilerplate must be written before the Rhizz compiler accepts a model without errors. This is against `SPEC.md`, which describes a gradual validation system, which detects incomplete definitions, emits warnings to the user, but **still allows to build the system**.

I suggest starting out this task with writing a new example in `examples/` that demonstrates all possible incomplete definitions and how the compiler handles them,
showcasing the compiler's flexibility in gradual validation.

It should later be expanded into unit tests, but that is only after the core idea is implemented and checked by the user.

---

## (For later brainstorming) Task <N> - pin existing nodes when auto-laying-out newly-added ones

Split out from Task 50 (now finished — see `FINISHED_TASKS.md`) as the one
remaining concrete piece of its original scope. `forceLayout.ts` already
supports pinning a node in place via `fixed: true` on a `LayoutNode` (sets
d3-force's `fx`/`fy`, ignored by all forces) — added specifically for this
case, but nothing calls it that way yet.

- When a component is checked onto the canvas (the sidebar checkbox's
  "check" branch), instead of just placing it at a default/remembered
  position, run a force-layout pass where every *other* currently-placed
  sibling is `fixed: true` and only the newly-checked node is free to
  move — so it settles into whatever gap is available near its
  connections, without visibly disturbing anything else already placed.
- Needs a concrete trigger decision: should this replace the current
  "restore remembered position, or default to (100, 100)" behavior
  unconditionally, or only when there's no remembered position to
  restore (i.e. first-time placement only, not re-checking something
  that was previously positioned)? Lean towards the latter — respecting
  a remembered position take priority over auto-placing.
- Validate with `deno task check`, `deno task build`, `deno task test`.

---

## (For later brainstorming) Task <N> - visual regression testing

As we now have a virtual filesystem hierarchy for the frontend, we can create
end-to-end tests which load the project, render a diagram and verify that it
matches the expected output.

Vitest supports visual regression testing. The goal of this task is to implement
infrastructure for visual regression testing in the frontend, then ask the
developer to create diagrams, which can be saved as reference images for future
comparisons.

---

## (For later) Task <N> — Multi-file workspace tabs and project import/export

Add a unified workspace view that lets users inspect the generated `system.hcl` and `views.hcl` files side-by-side with the visual canvas, and import/export projects.

- Tabbed workspace switcher:
  - "Canvas" (interactive visual modeler, default)
  - "system.hcl" (live code viewer / editor for the core architectural model)
  - "views.hcl" (live code viewer / editor for layout coordinates and view filters)
- File Import / Export:
  - "Export Project" downloads `system.hcl` and `views.hcl`.
  - "Open / Import" loads existing `.hcl` files into the GUI and auto-populates the visual model.
- Validate with `deno task check`, `deno task test`, `deno task build`.

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
